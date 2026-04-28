/**
 * API ROUTE: /api/ask
 * BACKEND: Vercel Serverless Function
 * AI MODEL: nvidia/nemotron-3-super-120b-a12b:free (via OpenRouter)
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { prompt, code, language } = req.body;

    // Constructing a high-intent system prompt to ensure structured JSON output
    const systemMessage = `
        You are Nexus AI, a pro-level coding assistant integrated into a VS Code-like editor.
        Your goal is to provide precise, high-quality code and explanations.
        
        RULES:
        1. Always return a valid JSON object.
        2. Format: { "code": "string", "explanation": "string" }
        3. If the user asks for a change, provide the full updated code in the "code" field.
        4. If the user asks a question, put the answer in "explanation".
        5. Current Language Context: ${language}
    `;

    const userMessage = `
        Context Code:
        \`\`\`${language}
        ${code}
        \`\`\`

        User Request: ${prompt}
    `;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, // Set this in Vercel
                "HTTP-Referer": "https://nexus-ai-editor.vercel.app", // Optional
                "X-Title": "Nexus AI Code Editor", // Optional
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "nvidia/nemotron-3-super-120b-a12b:free",
                "messages": [
                    { "role": "system", "content": systemMessage },
                    { "role": "user", "content": userMessage }
                ],
                "response_format": { "type": "json_object" } // Ensures the model stays in JSON mode
            })
        });

        const data = await response.json();

        // OpenRouter returns data in choices[0].message.content
        if (data.choices && data.choices[0]) {
            const aiResponse = JSON.parse(data.choices[0].message.content);
            return res.status(200).json(aiResponse);
        } else {
            console.error("OpenRouter Error:", data);
            return res.status(500).json({ message: "AI Model Error", details: data });
        }

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
}
    
