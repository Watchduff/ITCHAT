import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations } from '@/db/schema';
import { getOrCreateSession } from '@/lib/session';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionId = await getOrCreateSession();
  const { id } = await params;

  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.sessionId, sessionId)));

  return Response.json({ success: true });
}
