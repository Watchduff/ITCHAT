import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatMessages } from '@/db/schema';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversationId');

  if (!conversationId) {
    return Response.json({ error: 'conversationId is required' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));

  const uiMessages = rows.map((row) => ({
    id: String(row.id),
    role: row.role as 'user' | 'assistant',
    parts: [
      ...(row.attachments ?? []).map((a) => ({
        type: 'file' as const,
        mediaType: a.mediaType,
        url: a.url,
        filename: a.filename,
      })),
      ...(row.content ? [{ type: 'text' as const, text: row.content }] : []),
    ],
  }));

  return Response.json(uiMessages);
}
