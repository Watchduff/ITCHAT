import { config } from 'dotenv';
config({ path: '.env' });

import { embed } from 'ai';
import pLimit from 'p-limit';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { kbChunks } from '../db/schema';
import { scrapeKnowledgeBase, type ScrapedArticle } from '../lib/scraper';
import { scrapeOitWebsite } from '../lib/oitScraper';
import { chunkText } from '../lib/chunker';
import { embeddingModel } from '../lib/ai';

const limit = pLimit(5);

const SCRAPERS: Record<ScrapedArticle['source'], () => Promise<ScrapedArticle[]>> = {
  kb: scrapeKnowledgeBase,
  oit: scrapeOitWebsite,
};

// Usage: `pnpm ingest` (all sources), `pnpm ingest kb`, `pnpm ingest oit`.
// Add `--dry-run` to scrape and report without embedding or touching the database.
function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const requested = args.filter((a) => !a.startsWith('--'));
  const unknown = requested.filter((a) => !(a in SCRAPERS));
  if (unknown.length > 0) {
    throw new Error(`Unknown source(s): ${unknown.join(', ')}. Use: ${Object.keys(SCRAPERS).join(', ')}`);
  }
  const sources = (requested.length > 0 ? requested : Object.keys(SCRAPERS)) as ScrapedArticle['source'][];
  return { sources, dryRun };
}

async function ingest() {
  const { sources, dryRun } = parseArgs();
  console.log(`Starting ingestion pipeline for: ${sources.join(', ')}${dryRun ? ' (dry run)' : ''}`);

  // Different hosts, so the crawls can run side by side; each keeps its own politeness delay.
  const articles = (await Promise.all(sources.map((source) => SCRAPERS[source]()))).flat();

  if (dryRun) {
    for (const a of articles) {
      console.log(`[${a.source}] ${a.title} — ${a.url} (${chunkText(a.content).length} chunks)`);
    }
    console.log(`Dry run complete: ${articles.length} pages would be ingested.`);
    await pool.end();
    return;
  }

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
            source: article.source,
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
