import { type Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env' });

export default {
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: ['kb_chunks', 'sessions', 'conversations', 'chat_messages'],
} satisfies Config;
