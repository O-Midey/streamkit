import OpenAI from "openai";
import { fromOpenAI } from "streamkit/adapters/openai";
import type { StreamChunk } from "streamkit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { messages } = await req.json();

  const openaiMessages = messages.map((m: { role: string; text: string }) => ({
    role: m.role as "user" | "assistant",
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
