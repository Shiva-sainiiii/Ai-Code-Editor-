/**
 * NEXUS AI - SERVERLESS API ENDPOINT v3.0
 * ================================
 * Vercel Serverless Function
 * Purpose: AI Code Assistant via OpenRouter
 * Model: nvidia/nemotron-3-super-120b-a12b:free
 * 
 * Environment Variables Required:
 * - OPENROUTER_API_KEY (Set in Vercel Dashboard)
 * 
 * Usage:
 * POST /api/ask
 * Body: { prompt, code, language }
 */

export default async function handler(req, res) {
    // ============================================
    // 1. METHOD VALIDATION
    // ============================================
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false,
            message: 'Method Not Allowed',
            allowedMethods: ['POST']
        });
    }

    // ============================================
    // 2. REQUEST VALIDATION
    // ============================================
    const { prompt, code, language } = req.body;

    // Validate required fields
    if (!prompt || !code || !language) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields',
            required: ['prompt', 'code', 'language']
        });
    }

    // Validate field types
    if (typeof prompt !== 'string' || typeof code !== 'string' || typeof language !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Invalid field types. All fields must be strings.'
        });
    }

    // Validate API key
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('❌ CRITICAL: OPENROUTER_API_KEY not set in environment variables');
        return res.status(500).json({
            success: false,
            message: 'Server Configuration Error',
            detail: 'AI service not properly configured. Please contact admin.'
        });
    }

    // ============================================
    // 3. PREPARE AI PROMPTS
    // ============================================
    const systemMessage = `You are Nexus AI, a pro-level coding assistant integrated into a VS Code-like editor.
Your goal is to provide precise, high-quality code and explanations.

RULES:
1. Always return VALID JSON object only
2. Format: { "code": "string", "explanation": "string" }
3. If user asks for code change, provide FULL updated code in "code" field
4. If user asks a question, put detailed answer in "explanation" field
5. Current Language Context: ${language}
6. Be concise but comprehensive
7. Never include markdown code blocks - just raw code in JSON
8. Handle errors gracefully with clear messages`;

    const userMessage = `Context Code (${language}):
\`\`\`${language}
${code}
\`\`\`

User Request: ${prompt}

Respond in valid JSON format ONLY.`;

    // ============================================
    // 4. CALL OPENROUTER API
    // ============================================
    try {
        console.log(`📡 Calling OpenRouter API for ${language} code...`);

        const openrouterResponse = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': process.env.VERCEL_URL 
                        ? `https://${process.env.VERCEL_URL}` 
                        : 'https://nexus-ai-editor.vercel.app',
                    'X-Title': 'Nexus AI Code Editor',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Nexus-AI/3.0'
                },
                body: JSON.stringify({
                    model: 'nvidia/nemotron-3-super-120b-a12b:free',
                    messages: [
                        { role: 'system', content: systemMessage },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: 0.7,
                    max_tokens: 2000,
                    response_format: { type: 'json_object' }
                }),
                timeout: 30000 // 30 second timeout
            }
        );

        // ============================================
        // 5. HANDLE OPENROUTER RESPONSE
        // ============================================
        if (!openrouterResponse.ok) {
            const errorData = await openrouterResponse.json();
            console.error('❌ OpenRouter Error:', openrouterResponse.status, errorData);

            return res.status(openrouterResponse.status).json({
                success: false,
                message: 'AI Service Error',
                detail: errorData?.error?.message || 'Unknown error from OpenRouter',
                status: openrouterResponse.status
            });
        }

        const data = await openrouterResponse.json();

        // Validate response structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('❌ Invalid OpenRouter response format:', data);
            return res.status(500).json({
                success: false,
                message: 'AI Service returned invalid response format'
            });
        }

        const aiResponseText = data.choices[0].message.content;

        // ============================================
        // 6. PARSE AI RESPONSE
        // ============================================
        let aiResponse;
        try {
            aiResponse = JSON.parse(aiResponseText);
        } catch (parseError) {
            console.error('❌ JSON Parse Error:', parseError, 'Response:', aiResponseText);
            
            // Fallback: try to extract JSON from response
            const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    aiResponse = JSON.parse(jsonMatch[0]);
                } catch (e) {
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to parse AI response',
                        detail: 'AI returned invalid JSON format'
                    });
                }
            } else {
                return res.status(500).json({
                    success: false,
                    message: 'Invalid AI response format',
                    detail: 'Could not extract JSON from response'
                });
            }
        }

        // Validate parsed response structure
        if (!aiResponse.code && !aiResponse.explanation) {
            return res.status(500).json({
                success: false,
                message: 'AI response missing required fields',
                required: ['code', 'explanation']
            });
        }

        // ============================================
        // 7. RETURN SUCCESS RESPONSE
        // ============================================
        console.log('✅ AI Response generated successfully');

        return res.status(200).json({
            success: true,
            data: {
                code: aiResponse.code || null,
                explanation: aiResponse.explanation || 'No explanation provided',
                language: language,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        // ============================================
        // 8. ERROR HANDLING
        // ============================================
        console.error('❌ Server Error:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });

        // Determine error type and status code
        let statusCode = 500;
        let errorMessage = 'Internal Server Error';
        let errorDetail = error.message;

        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            statusCode = 504;
            errorMessage = 'Request Timeout';
            errorDetail = 'AI service took too long to respond';
        } else if (error.message.includes('Network')) {
            statusCode = 503;
            errorMessage = 'Service Unavailable';
            errorDetail = 'Cannot reach AI service';
        } else if (error.message.includes('JSON')) {
            statusCode = 400;
            errorMessage = 'Invalid Request';
            errorDetail = 'Request body is not valid JSON';
        }

        return res.status(statusCode).json({
            success: false,
            message: errorMessage,
            detail: errorDetail,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * DEPLOYMENT INSTRUCTIONS:
 * ========================
 * 
 * 1. VERCEL SETUP:
 *    - Push this file to: /api/ask.js
 *    - Deploy to Vercel using: vercel deploy
 * 
 * 2. ENVIRONMENT VARIABLES:
 *    Go to Vercel Dashboard → Settings → Environment Variables
 *    Add:
 *    - Key: OPENROUTER_API_KEY
 *    - Value: your_actual_api_key_here
 * 
 * 3. GET OPENROUTER API KEY:
 *    - Visit: https://openrouter.ai
 *    - Sign up / Login
 *    - Go to Keys section
 *    - Create new API key
 *    - Copy and paste into Vercel environment variables
 * 
 * 4. CALL FROM FRONTEND:
 *    const response = await fetch('/api/ask', {
 *        method: 'POST',
 *        headers: { 'Content-Type': 'application/json' },
 *        body: JSON.stringify({
 *            prompt: 'Fix this code',
 *            code: 'function test() { ... }',
 *            language: 'javascript'
 *        })
 *    });
 *    const result = await response.json();
 *    console.log(result.data);
 * 
 * 5. TROUBLESHOOTING:
 *    - Check Vercel Logs: vercel logs
 *    - Test API: curl -X POST https://your-app.vercel.app/api/ask \
 *      -H "Content-Type: application/json" \
 *      -d '{"prompt":"test","code":"x","language":"js"}'
 * 
 * 6. MONITORING:
 *    - Monitor API usage: https://openrouter.ai/usage
 *    - Check Vercel dashboard for errors
 *    - Review response times in Vercel analytics
 */
