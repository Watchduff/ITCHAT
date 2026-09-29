import { generateText } from 'ai';
import { chatModel } from '@/lib/ai';

export const maxDuration = 15;

const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_LENGTH = 60;
const TRANSCRIPT_MESSAGES = 4;

const SYSTEM_PROMPT = `You write one-click reply buttons for an IT help desk technician who is chatting with a troubleshooting assistant while a caller waits. The technician should be able to answer by clicking instead of typing.

Given the conversation, write the replies the technician is most likely to need next, from the TECHNICIAN's point of view.

Rules:
- Each reply must be something the technician could send as-is: an answer, a result, or a request. Never write a question the assistant would ask.
- Keep each reply under 8 words. No numbering, no trailing punctuation.
- If the assistant asked a question, cover the realistic answers to it. For a brand or model question, name the common manufacturers. For an either/or question, give each option.
- If the assistant asked more than one question, answer only the FIRST one — the technician will click through the rest.
- If the assistant gave troubleshooting steps, cover the likely outcomes: it worked, it did not work, an error appeared.
- Include an escape hatch when one fits, such as "Not sure" or "Caller does not know".
- When the issue sounds resolved or escalated, include "Write the ticket note".
- Give 3 to 5 replies. No duplicates.

Return ONLY a JSON array of strings, for example: ["Windows PC","Mac","Not sure"]`;

interface IncomingMessage {
  role: 'user' | 'assistant';
  text: string;
}

function parseSuggestions(raw: string): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ').slice(0, MAX_SUGGESTION_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(text);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

export async function POST(req: Request) {
  const { messages }: { messages?: IncomingMessage[] } = await req.json().catch(() => ({}));

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ suggestions: [] });
  }

  // Quick replies only make sense as an answer to something the assistant just said.
  const recent = messages.slice(-TRANSCRIPT_MESSAGES).filter((m) => m?.text?.trim());
  const last = recent[recent.length - 1];
  if (!last || last.role !== 'assistant') {
    return Response.json({ suggestions: [] });
  }

  const transcript = recent
    .map((m) => `${m.role === 'user' ? 'Technician' : 'Assistant'}: ${m.text.trim()}`)
    .join('\n\n');

  try {
    const { text } = await generateText({
      model: chatModel,
      system: SYSTEM_PROMPT,
      prompt: transcript,
      maxOutputTokens: 200,
    });
    return Response.json({ suggestions: parseSuggestions(text) });
  } catch {
    // Quick replies are a convenience — the technician can always type instead.
    return Response.json({ suggestions: [] });
  }
}
