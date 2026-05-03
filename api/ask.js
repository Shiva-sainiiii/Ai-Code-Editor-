/**
 * NEXUS AI — Vercel Serverless Function v5.0
 * /api/ask
 *
 * Improvements:
 * - Input validation with descriptive error messages
 * - Rate limiting via in-memory store (upgrade to Upstash Redis in prod)
 * - Code truncation prevents context-window overflow
 * - OpenRouter model fallback chain
 * - Security: strips server-side secrets, no leakage in error messages
 * - CORS headers for preview deployments
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Simple in-memory rate limiter (resets on cold start)
// Replace with Upstash Redis for production multi-instance deployments
const _rateMap = new Map();   // ip -> { count, resetAt }
const RATE_LIMIT    = 20;     // requests
const RATE_WINDOW   = 60_000; // ms (1 minute)

// Model preference chain — falls back if primary is overloaded
const MODELS = [
  'anthropic/claude-3-haiku',
  'openai/gpt-4o-mini',
  'mistralai/mistral-7b-instruct',
];

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS — allow the app's own origin
  res.setHeader('Access-Control-Allow-Origin',  process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // ── Rate limiting ──────────────────────────────────────────
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';

  if (!_checkRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please wait a moment.',
    });
  }

  // ── Validate input ─────────────────────────────────────────
  const { prompt, code, language, fileName } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ success: false, message: 'prompt is required' });
  }
  if (prompt.length > 2000) {
    return res.status(400).json({ success: false, message: 'prompt exceeds 2000 chars' });
  }

  const safeCode     = _truncate(String(code || ''), 6000);
  const safeLang     = _sanitizeId(language) || 'code';
  const safeFile     = _sanitizeId(fileName) || 'untitled';
  const safePrompt   = prompt.trim();

  // ── Build messages ─────────────────────────────────────────
  const systemPrompt = `You are Nexus AI, an expert coding assistant embedded in a browser IDE.
You are currently viewing the file: ${safeFile} (language: ${safeLang}).

RESPONSE FORMAT — always respond with valid JSON in this exact shape:
{
  "code": "<complete updated file content, or empty string if no code changes needed>",
  "explanation": "<clear, concise explanation of what you did or found — plain text, no markdown>"
}

RULES:
- If the user asks a question, set "code" to "" and explain in "explanation".
- If you modify code, return the ENTIRE file content in "code" (not just the changed lines).
- Keep "explanation" under 300 words and in plain language.
- Never include triple backticks or language tags inside "code".
- Preserve the user's coding style and indentation.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: safeCode
        ? `File content:\n\`\`\`${safeLang}\n${safeCode}\n\`\`\`\n\nRequest: ${safePrompt}`
        : `Request: ${safePrompt}`,
    },
  ];

  // ── Call OpenRouter with model fallback ────────────────────
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set');
    return res.status(500).json({ success: false, message: 'AI service not configured' });
  }

  let lastError = null;

  for (const model of MODELS) {
    try {
      const aiRes = await fetch(OPENROUTER_API_URL, {
        method:  'POST',
        headers: {
          'Authorization':  `Bearer ${apiKey}`,
          'Content-Type':   'application/json',
          'HTTP-Referer':   process.env.APP_ORIGIN || 'https://nexus-ai.vercel.app',
          'X-Title':        'Nexus AI',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens:   1500,
          temperature:  0.2,
          top_p:        0.95,
        }),
        // Vercel functions have a 30s timeout — this prevents hanging
        signal: AbortSignal.timeout(25_000),
      });

      if (!aiRes.ok) {
        const body = await aiRes.json().catch(() => ({}));
        // Retry on rate limit or server errors
        if (aiRes.status === 429 || aiRes.status >= 500) {
          lastError = new Error(`Model ${model} returned ${aiRes.status}`);
          continue;
        }
        return res.status(aiRes.status).json({
          success: false,
          message: body.error?.message || 'AI service error',
        });
      }

      const data    = await aiRes.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '';

      // Parse the JSON response from the AI
      let parsed;
      try {
        // Strip potential markdown code fences the model might add despite instructions
        const clean = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        // If JSON parse fails, treat the whole content as an explanation
        parsed = { code: '', explanation: content };
      }

      return res.status(200).json({
        success: true,
        data: {
          code:        parsed.code        ?? '',
          explanation: parsed.explanation ?? '',
        },
        model,
      });

    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError' || err.name === 'TimeoutError') break;
      // Network error — try next model
      console.warn(`Model ${model} failed, trying next:`, err.message);
    }
  }

  console.error('All models failed:', lastError?.message);
  return res.status(503).json({
    success: false,
    message: 'AI service temporarily unavailable. Please try again.',
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _checkRateLimit(ip) {
  const now  = Date.now();
  const info = _rateMap.get(ip);

  if (!info || now > info.resetAt) {
    _rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }

  if (info.count >= RATE_LIMIT) return false;

  info.count++;
  return true;
}

/** Truncate a string to maxLen chars, adding ellipsis */
function _truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n… (truncated)';
}

/** Strip anything that isn't a safe identifier character */
function _sanitizeId(str) {
  return String(str || '').replace(/[^a-zA-Z0-9._\-+ ]/g, '').slice(0, 64);
}
