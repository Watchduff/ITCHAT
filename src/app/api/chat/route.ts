import { streamText, generateText, embed, convertToModelMessages, type UIMessage } from 'ai';
import { sql, eq, count } from 'drizzle-orm';
import { db } from '@/db';
import { chatMessages, conversations } from '@/db/schema';
import { getOrCreateSession } from '@/lib/session';
import { chatModel, embeddingModel } from '@/lib/ai';

export const maxDuration = 30;

const SYSTEM_PROMPT_HEADER = `You are the IT Help Desk internal assistant for BYU-Hawaii's Office of Information Technology (OIT). You work alongside help desk technicians — including student labor / work-study workers — while they resolve a live ticket. Act like an experienced senior technician coaching them through it, not a search engine: diagnose with them, one step at a time.

How to run a ticket:
1. Triage first. If the ticket is missing details that would change your recommendation (which system or service, the exact error or symptom, who is affected — student, staff, or faculty — device/OS, on or off campus, when it started or what changed, and for hardware — the make/model or brand, e.g. which printer, laptop, or phone brand, since the fix often differs by manufacturer), ask ONE short, specific question and stop — the technician answers by clicking a suggested reply, so a single question at a time keeps them moving. Ask only what you need, most important first. If the knowledge base clearly points to one likely fix, skip the questions, give the fix, and state any assumption you made.
2. Guide step by step. Give the most likely fix as 1-3 numbered steps, then ask the technician to tell you what happened. Do not list every possible procedure at once.
3. Adapt to what they report. Use the technician's replies: never repeat a step they already tried, and if a step failed, move to the next most likely cause. Ask for the exact error text when a result is unclear.
4. Know when to escalate. Recommend escalation when the knowledge base steps are exhausted, the KB doesn't cover the issue, several users are affected (possible outage), there is any sign of account compromise or a security concern, data may be lost, or the fix needs access the technician doesn't have. Say what information to include in the escalation. Do not invent team names, contacts, or procedures — if the KB doesn't name them, say "escalate to the next tier per your team's process".
5. Close out. When the technician confirms the issue is resolved, or you are escalating, offer a short paste-ready ticket note in this form: Issue / Steps taken / Resolution (or Escalated to + reason).

Ground rules:
- Base all troubleshooting steps and facts on the KNOWLEDGE BASE CONTEXT below. If it doesn't cover the issue, say so plainly and suggest escalating or searching the KB manually — do not invent steps. Asking clarifying questions never requires KB context.
- Be direct and concise. Put your question for the technician at the end of the message, in bold, so it's easy to spot.
- Always cite which source(s) you used. For public KB articles and OIT website (oit.byuh.edu) pages, give the URL so the technician can paste it into the ticket. For internal documents, give the document name instead — do not invent a URL for it.
- For a hardware issue where the fix depends on the manufacturer (printer, laptop, phone, etc.) and the KB has no brand-specific article once you know the brand, say so, give your best general troubleshooting steps for that brand, and point the technician to that manufacturer's official support site as a secondary reference (e.g. support.hp.com, support.brother.com, epson.com/support, support.canon.com, support.lexmark.com, xerox.com/support, support.dell.com, support.apple.com). Label this clearly as outside the internal KB, and only give the vendor's main support domain — never invent a specific article URL on their site.
- Pay special attention to student labor / work-study related issues (Workday timesheets, office location changes, student employment onboarding, lab worker accounts) — these tickets are a priority for this team.
- If multiple sources are relevant, briefly note the differences (e.g. "for Housing routers, see X; for campus network, see Y").`;

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

const REWRITE_HISTORY_MESSAGES = 6;

// Follow-ups like "tried that, no change" are useless as a search query on their own,
// so turn the latest message into a standalone KB search query using the conversation so far.
async function buildSearchQuery(messages: UIMessage[], latestText: string): Promise<string> {
  if (messages.length <= 1 || !latestText) return latestText;

  const transcript = messages
    .slice(-REWRITE_HISTORY_MESSAGES)
    .map((m) => `${m.role === 'user' ? 'Technician' : 'Assistant'}: ${extractText(m)}`)
    .join('\n');

  try {
    const { text } = await generateText({
      model: chatModel,
      system:
        'You write search queries for an IT help desk knowledge base. Given a troubleshooting conversation, write ONE standalone search query (max 30 words) that captures the core issue: the system or service, the symptom or exact error text, and any relevant device/OS or user type. Include what the technician already tried only if it changes what to search for. Output only the query, no quotes or explanation.',
      prompt: transcript,
      maxOutputTokens: 80,
    });
    return text.trim() || latestText;
  } catch {
    return latestText;
  }
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

  const searchQuery = await buildSearchQuery(messages, queryText);
  const { embedding } = await embed({ model: embeddingModel, value: searchQuery });
  const vectorLiteral = toVectorLiteral(embedding);

  const relevantChunks = await db.execute<{
    url: string;
    title: string;
    category: string;
    content: string;
    source: string;
  }>(sql`
    SELECT url, title, category, content, source
    FROM kb_chunks
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT 5
  `);

  const contextBlock = relevantChunks.rows
    .map((chunk, i) => {
      const sourceLine =
        chunk.source === 'upload'
          ? `Source: Internal document "${chunk.title}" (no public URL — refer technicians to this document by name, not a link)`
          : `URL: ${chunk.url}`;
      return `[${i + 1}] "${chunk.title}" (Category: ${chunk.category || 'General'})\n${sourceLine}\n${chunk.content}`;
    })
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
