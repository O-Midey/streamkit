import OpenAI from "openai";
import { fromOpenAI } from "streamkit/adapters/openai";
import type { StreamChunk } from "streamkit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { chatRequestSchema } from "@/lib/validation";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function POST(req: Request) {
  // 1. Rate limit per IP before any work or model call.
  const limit = await checkRateLimit(getClientIp(req));
  if (limit && !limit.success) {
    return json({ error: "Rate limit exceeded. Please slow down." }, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  // 2. Validate + cap the input at the boundary (bounds input-token cost).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid request: messages must be 1–20 items, each ≤ 4000 chars." }, 400);
  }
  const { messages } = parsed.data;

  const openaiMessages = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant demonstrating streamkit — a React library for streaming LLM UI.

When answering coding questions, include code blocks with the correct language tag (typescript, python, bash, etc.)
Format explanations with markdown — use headers, lists, and emphasis where they aid clarity.
Use the search tool when you need to look something up (this demo wires it to a mock).`,
      },
      ...openaiMessages,
    ],
    stream: true,
  });

  const encoder = new TextEncoder();
  const source = fromOpenAI({ stream });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of source) {
          controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
        }
      } catch (err) {
        const errChunk: StreamChunk = {
          type: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        };
        controller.enqueue(encoder.encode(JSON.stringify(errChunk) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
