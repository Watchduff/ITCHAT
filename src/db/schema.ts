import {
  customType, integer, serial, text,
  timestamp, uuid
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

// Custom pgvector type (1536 dims = OpenAI text-embedding-3-small)
const vector = customType<{
  data: number[];
  driverData: string
}>({
  dataType() { return 'vector(1536)'; },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1).split(',').map(Number);
  },
  toDriver(value: number[]): string {
    return '[' + value.join(',') + ']';
  },
});

// KB article chunks with embeddings
export const kbChunks = pgTable('kb_chunks', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull().default(''),
  category: text('category').notNull().default(''),
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Session tracking (anonymous visitors / agents)
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Conversation threads
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull()
    .references(() => sessions.id),
  title: text('title').notNull().default('New conversation'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Individual chat messages
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
