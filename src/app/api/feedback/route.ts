import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { chatMessages, conversations, messageFeedback } from '@/db/schema';
import { getOrCreateSession } from '@/lib/session';
import {
  FEEDBACK_RATINGS,
  FEEDBACK_REASONS,
  MAX_FEEDBACK_COMMENT_LENGTH,
  type FeedbackRating,
} from '@/lib/feedback';

// Unauthenticated admin view — see src/app/admin/feedback for the caveat.
export async function GET() {
  const rows = await db
    .select({
      id: messageFeedback.id,
      conversationId: messageFeedback.conversationId,
      rating: messageFeedback.rating,
      reason: messageFeedback.reason,
      comment: messageFeedback.comment,
      question: messageFeedback.question,
      answer: messageFeedback.answer,
      createdAt: messageFeedback.createdAt,
    })
    .from(messageFeedback)
    .orderBy(desc(messageFeedback.createdAt))
    .limit(500);

  return Response.json(rows);
}

export async function POST(req: Request) {
  const sessionId = await getOrCreateSession();

  const body = await req.json().catch(() => null);
  const conversationId: unknown = body?.conversationId;
  const rating: unknown = body?.rating;
  const reason: unknown = body?.reason;
  const comment: unknown = body?.comment;

  if (typeof conversationId !== 'string' || !FEEDBACK_RATINGS.includes(rating as FeedbackRating)) {
    return Response.json({ error: 'conversationId and a valid rating are required' }, { status: 400 });
  }
  if (reason != null && !(FEEDBACK_REASONS as readonly string[]).includes(reason as string)) {
    return Response.json({ error: 'Invalid reason' }, { status: 400 });
  }
  if (comment != null && (typeof comment !== 'string' || comment.length > MAX_FEEDBACK_COMMENT_LENGTH)) {
    return Response.json({ error: 'Invalid comment' }, { status: 400 });
  }

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.sessionId, sessionId)))
    .limit(1);
  if (!conversation) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // Feedback is always about the most recent answer in the conversation.
  const [answer] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.role, 'assistant')))
    .orderBy(desc(chatMessages.id))
    .limit(1);
  if (!answer) {
    return Response.json({ error: 'No assistant message to rate' }, { status: 404 });
  }

  const [question] = await db
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.role, 'user'),
        lt(chatMessages.id, answer.id)
      )
    )
    .orderBy(desc(chatMessages.id))
    .limit(1);

  const values = {
    rating: rating as FeedbackRating,
    reason: (reason as string | null | undefined) || null,
    comment: (comment as string | null | undefined)?.trim() || null,
  };

  await db
    .insert(messageFeedback)
    .values({
      messageId: answer.id,
      conversationId,
      sessionId,
      question: question?.content ?? null,
      answer: answer.content,
      ...values,
    })
    .onConflictDoUpdate({
      target: messageFeedback.messageId,
      set: { ...values, updatedAt: new Date() },
    });

  return Response.json({ ok: true });
}
