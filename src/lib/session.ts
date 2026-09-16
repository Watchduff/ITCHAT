import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions } from '@/db/schema';

const COOKIE_NAME = 'itkb_session';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function getOrCreateSession(): Promise<string> {
  const cookieStore = await cookies();
  const existingId = cookieStore.get(COOKIE_NAME)?.value;

  if (existingId) {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, existingId))
      .limit(1);
    if (session) return session.id;
  }

  const [newSession] = await db.insert(sessions).values({}).returning();

  cookieStore.set(COOKIE_NAME, newSession.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ONE_YEAR_SECONDS,
    path: '/',
  });

  return newSession.id;
}
