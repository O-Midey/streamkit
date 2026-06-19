import OpenAI from "openai";
import { fromOpenAI } from "streamkit-ui/adapters/openai";
import type { StreamChunk } from "streamkit-ui";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { chatRequestSchema } from "@/lib/validation";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Tool definitions advertised to the model. Only the JSON schema lives here —
 * the actual execution is the client's mock (chat.tsx), since this demo's goal
 * is to show streamkit rendering the tool-call lifecycle, not to run a real
 * search backend.
 */
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Search the web for current information. Use for recent events, library/version facts, or anything that should be verified rather than recalled.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

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
Use the search tool when the user asks about recent events, library versions, or anything you should look up (this demo wires it to a mock executed client-side).`,
      },
      ...openaiMessages,
    ],
    // Expose a single `search` tool so the demo exercises streamkit's
    // tool-call rendering. The model decides when to call it (tool_choice
    // defaults to "auto"); the mock implementation runs on the client via
    // useChatStream's `tools` registry — see chat.tsx.
    tools: TOOLS,
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
