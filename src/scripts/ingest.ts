import { config } from 'dotenv';
config({ path: '.env' });

import { embed } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import pLimit from 'p-limit';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { kbChunks } from '../db/schema';
import { scrapeKnowledgeBase } from '../lib/scraper';
import { chunkText } from '../lib/chunker';

const embeddingModel = gateway.textEmbeddingModel('openai/text-embedding-3-small');
const limit = pLimit(5);

async function ingest() {
  console.log('Starting ingestion pipeline...');

  const articles = await scrapeKnowledgeBase();

  for (const article of articles) {
    const chunks = chunkText(article.content);
    console.log(`Processing ${article.url} -> ${chunks.length} chunks`);

    // Idempotent re-runs: clear old chunks for this URL first.
    await db.delete(kbChunks).where(eq(kbChunks.url, article.url));

    await Promise.all(
      chunks.map((chunk, index) =>
        limit(async () => {
          const { embedding } = await embed({
            model: embeddingModel,
            value: chunk,
          });

          await db.insert(kbChunks).values({
            url: article.url,
            title: article.title,
            category: article.category,
            content: chunk,
            chunkIndex: index,
            embedding,
          });
        })
      )
    );
  }

  console.log('Ingestion complete!');
  await pool.end();
}

ingest().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
