import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations } from '@/db/schema';
import { getOrCreateSession } from '@/lib/session';

export async function GET() {
  const sessionId = await getOrCreateSession();

  const results = await db
    .select()
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .orderBy(desc(conversations.createdAt));

  return Response.json(results);
}

export async function POST() {
  const sessionId = await getOrCreateSession();

  const [conversation] = await db
    .insert(conversations)
    .values({ sessionId })
    .returning();

  return Response.json(conversation);
}
