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

// Staff-uploaded documents (runbooks, past-ticket exports, etc.)
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  fileType: text('file_type').notNull(),
  status: text('status').notNull().default('processing'), // processing | ready | failed
  chunkCount: integer('chunk_count').notNull().default(0),
  errorMessage: text('error_message'),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
});

// KB article, OIT website, and uploaded-document chunks with embeddings
export const kbChunks = pgTable('kb_chunks', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull().default(''),
  category: text('category').notNull().default(''),
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  embedding: vector('embedding'),
  source: text('source').notNull().default('kb'), // kb | oit | upload
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
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

// Technician feedback on an assistant answer (one row per answer)
export const messageFeedback = pgTable('message_feedback', {
  id: serial('id').primaryKey(),
  messageId: integer('message_id')
    .notNull()
    .unique()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  rating: text('rating').notNull(), // helpful | partial | not_helpful
  reason: text('reason'),
  comment: text('comment'),
  question: text('question'),
  answer: text('answer').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
