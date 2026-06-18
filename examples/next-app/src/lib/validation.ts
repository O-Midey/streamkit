import { z } from "zod";

/**
 * Validation + hard caps for the chat request body. This is the primary
 * credit-protection layer: rate limiting bounds request *frequency*, but a
 * single request with a huge `messages` array can burn input tokens on its own.
 * Capping message count and per-message length bounds the input-token cost of
 * any individual call.
 */

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4_000;

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
