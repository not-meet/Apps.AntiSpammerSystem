import { IHttp } from '@rocket.chat/apps-engine/definition/accessors';

export interface AiConfig {
    provider: 'none' | 'gemini' | 'groq';
    apiKey: string;
    model: string;
}

export class AiService {
    public static async query(http: IHttp, config: AiConfig, prompt: string): Promise<string> {
        if (config.provider === 'none' || !config.apiKey) {
            return 'AI is not configured.';
        }

        try {
            switch (config.provider) {
                case 'gemini':
                    return await AiService.queryGemini(http, config, prompt);
                case 'groq':
                    return await AiService.queryGroq(http, config, prompt);
                default:
                    return 'AI is not configured.';
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `AI request failed: ${message}`;
        }
    }

    public static buildReportSummaryPrompt(reportText: string): string {
        return [
            'You are a concise anti-spam monitoring system for Rocket.Chat.',
            'Give a SHORT status-style summary (max 8-10 lines). Use bullet points.',
            'Format: key metrics first, then any threats/patterns, then 1-2 action items if needed.',
            'Do NOT write essays, tables, or long explanations. Be direct like a monitoring dashboard alert.',
            'If there are no concerns, just say "All clear" with the key numbers.',
            '',
            reportText,
        ].join('\n');
    }

    public static buildUserAnalysisPrompt(username: string, flagDetails: string): string {
        return [
            'You are a concise anti-spam monitoring system for Rocket.Chat.',
            `Give a brief threat assessment for user "${username}" (max 6-8 lines).`,
            'Include: risk level (low/medium/high/critical), pattern detected, and one recommended action.',
            'Do NOT write long essays or detailed tables. Be concise like a security alert.',
            '',
            flagDetails,
        ].join('\n');
    }

    public static buildChaosLevelQueryPrompt(level: number, usersList: string): string {
        return [
            'You are a concise anti-spam monitoring system for Rocket.Chat.',
            `Briefly list users at chaos level ${level} with a one-line assessment each (max 6-8 lines total).`,
            'Do NOT write long explanations. Be direct like a monitoring dashboard.',
            '',
            usersList,
        ].join('\n');
    }

    private static async queryGemini(http: IHttp, config: AiConfig, prompt: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
        const response = await http.post(url, {
            headers: { 'Content-Type': 'application/json' },
            data: {
                contents: [{ parts: [{ text: prompt }] }],
            },
        });

        if (response.statusCode !== 200) {
            return `Gemini API error (HTTP ${response.statusCode}): ${response.content}`;
        }

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            return 'Gemini returned an empty response.';
        }

        return text;
    }

    private static async queryGroq(http: IHttp, config: AiConfig, prompt: string): Promise<string> {
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        const response = await http.post(url, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            data: {
                model: config.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
            },
        });

        if (response.statusCode !== 200) {
            return `Groq API error (HTTP ${response.statusCode}): ${response.content}`;
        }

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
            return 'Groq returned an empty response.';
        }

        return content;
    }
}
