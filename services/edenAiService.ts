
import { GoogleGenAI } from "@google/genai";
import { Message } from '../types';

export const getSummary = async (messages: Message[]): Promise<string> => {
    if (messages.length < 2) {
        return "The conversation has just begun.";
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const historyText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [{ 
                role: 'user', 
                parts: [{ text: `Summarize this conversation in one concise sentence:\n\n${historyText}` }] 
            }],
        });

        return response.text || "A complex exchange of quantum data.";
        
    } catch (error) {
        console.error("Error fetching summary from Gemini:", error);
        return "Could not generate a summary at this time.";
    }
};
