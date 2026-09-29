import { openai } from '@ai-sdk/openai';

export const chatModel = openai('gpt-4o-mini');
export const embeddingModel = openai.textEmbeddingModel('text-embedding-3-small');
