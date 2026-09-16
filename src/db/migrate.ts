import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env' });

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
  });
  const client = await pool.connect();

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('pgvector extension ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        embedding vector(1536),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
        kb_chunks_embedding_idx
      ON kb_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id),
        title TEXT NOT NULL DEFAULT 'New conversation',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        conversation_id UUID NOT NULL
          REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS
        chat_messages_conversation_idx
      ON chat_messages
        (conversation_id, created_at);
    `);

    console.log('All migrations complete!');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
