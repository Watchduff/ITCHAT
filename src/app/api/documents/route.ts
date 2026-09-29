import { embed } from 'ai';
import { desc, eq } from 'drizzle-orm';
import pLimit from 'p-limit';
import { db } from '@/db';
import { documents, kbChunks } from '@/db/schema';
import { chunkText } from '@/lib/chunker';
import { extractText, SUPPORTED_EXTENSIONS } from '@/lib/documentParser';
import { embeddingModel } from '@/lib/ai';

export const maxDuration = 60;

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export async function GET() {
  const results = await db.select().from(documents).orderBy(desc(documents.uploadedAt));
  return Response.json(results);
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return Response.json(
      { error: `Unsupported file type ".${extension}". Allowed: PDF, DOCX, XLSX, XLS, CSV.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: 'File exceeds the 15MB limit.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const [doc] = await db
    .insert(documents)
    .values({ filename: file.name, fileType: extension, status: 'processing' })
    .returning();

  try {
    const text = await extractText(buffer, extension);
    if (!text.trim()) throw new Error('No extractable text found in this file.');

    const chunks = chunkText(text);
    const limit = pLimit(5);

    await Promise.all(
      chunks.map((chunk, index) =>
        limit(async () => {
          const { embedding } = await embed({ model: embeddingModel, value: chunk });
          await db.insert(kbChunks).values({
            url: file.name,
            title: file.name,
            category: 'Internal Runbook',
            content: chunk,
            chunkIndex: index,
            embedding,
            source: 'upload',
            documentId: doc.id,
          });
        })
      )
    );

    const [updated] = await db
      .update(documents)
      .set({ status: 'ready', chunkCount: chunks.length })
      .where(eq(documents.id, doc.id))
      .returning();

    return Response.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await db.update(documents).set({ status: 'failed', errorMessage: message }).where(eq(documents.id, doc.id));
    return Response.json({ error: `Failed to process "${file.name}": ${message}` }, { status: 500 });
  }
}
