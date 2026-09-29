import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(documents).where(eq(documents.id, id));
  return Response.json({ success: true });
}
