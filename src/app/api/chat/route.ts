import { streamText, embed, convertToModelMessages, type UIMessage } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { sql, eq, count } from 'drizzle-orm';
import { db } from '@/db';
import { chatMessages, conversations } from '@/db/schema';
import { getOrCreateSession } from '@/lib/session';

export const maxDuration = 30;

const chatModel = gateway('openai/gpt-4o-mini');
const embeddingModel = gateway.textEmbeddingModel('openai/text-embedding-3-small');

const SYSTEM_PROMPT_HEADER = `You are the IT Help Desk internal assistant for BYU-Hawaii's Office of Information Technology (OIT). You help IT help desk technicians — including student labor / work-study workers — quickly troubleshoot tickets by grounding answers in the official knowledge base.

Guidelines:
- Only answer using the KNOWLEDGE BASE CONTEXT provided below. If the context doesn't cover the issue, say so plainly and suggest escalating or searching the KB manually — do not invent steps.
- Write for a technician resolving a live ticket: be direct, use numbered steps for procedures, and lead with the most likely fix.
- Always cite which KB article(s) you used, with their URL, so the technician can paste the link into the ticket.
- Pay special attention to student labor / work-study related issues (Workday timesheets, office location changes, student employment onboarding, lab worker accounts) — these tickets are a priority for this team.
- If multiple KB articles are relevant, briefly note the differences (e.g. "for Housing routers, see X; for campus network, see Y").`;

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function POST(req: Request) {
  await getOrCreateSession();

  const { id: conversationId, messages }: { id: string; messages: UIMessage[] } = await req.json();

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const queryText = lastUserMessage ? extractText(lastUserMessage) : '';

  await db.insert(chatMessages).values({
    conversationId,
    role: 'user',
    content: queryText,
  });

  const [{ value: messageCount }] = await db
    .select({ value: count() })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));

  if (messageCount === 1) {
    const title = queryText.slice(0, 80) || 'New conversation';
    await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
  }

  const { embedding } = await embed({ model: embeddingModel, value: queryText });
  const vectorLiteral = toVectorLiteral(embedding);

  const relevantChunks = await db.execute<{
    url: string;
    title: string;
    category: string;
    content: string;
  }>(sql`
    SELECT url, title, category, content
    FROM kb_chunks
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT 5
  `);

  const contextBlock = relevantChunks.rows
    .map(
      (chunk, i) =>
        `[${i + 1}] Article: "${chunk.title}" (Category: ${chunk.category || 'General'})\nURL: ${chunk.url}\n${chunk.content}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `${SYSTEM_PROMPT_HEADER}\n\nKNOWLEDGE BASE CONTEXT:\n\n${contextBlock || 'No relevant articles found.'}`;

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    onFinish: async ({ text }) => {
      await db.insert(chatMessages).values({
        conversationId,
        role: 'assistant',
        content: text,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
