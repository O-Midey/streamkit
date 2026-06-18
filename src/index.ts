// Hooks
export { useTokenStream } from "./hooks/useTokenStream";
export type { UseTokenStreamOptions, UseTokenStreamResult } from "./hooks/useTokenStream";

export { useToolCallState } from "./hooks/useToolCallState";
export type {
  ToolImplementation,
  ToolRegistry,
  UseToolCallStateOptions,
  UseToolCallStateResult,
} from "./hooks/useToolCallState";

export { useChatStream } from "./hooks/useChatStream";
export type { UseChatStreamOptions, UseChatStreamResult } from "./hooks/useChatStream";

export { useStreamQueue } from "./hooks/useStreamQueue";
export type {
  UseStreamQueueOptions,
  UseStreamQueueResult,
  QueuedStreamState,
} from "./hooks/useStreamQueue";

export { createResumableStream } from "./hooks/createResumableStream";
export type { CreateResumableStreamOptions, ResumeContext } from "./hooks/createResumableStream";

// Components
export { StreamingMarkdown } from "./components/StreamingMarkdown";
export type { StreamingMarkdownProps } from "./components/StreamingMarkdown";

export { StreamStatus } from "./components/StreamStatus";
export type { StreamStatusProps } from "./components/StreamStatus";

export { StreamingCodeBlock } from "./components/StreamingCodeBlock";
export type { StreamingCodeBlockProps } from "./components/StreamingCodeBlock";

// Adapters (imported via subpath: streamkit/adapters/vercel-ai-sdk, etc.)
// Re-exported here for convenience; prefer the subpath imports in production
// to avoid bundling all three adapters when you only use one.
export { fromVercelAISDK } from "./adapters/vercel-ai-sdk";
export type { VercelAISDKAdapterOptions } from "./adapters/vercel-ai-sdk";

export { fromAnthropic } from "./adapters/anthropic";
export type { AnthropicAdapterOptions } from "./adapters/anthropic";

export { fromOpenAI } from "./adapters/openai";
export type { OpenAIAdapterOptions } from "./adapters/openai";

// Shared types
export type {
  StreamChunk,
  StreamSource,
  StreamSourceFactory,
  StreamStatusValue,
  TextChunk,
  ToolCallStartChunk,
  ToolCallDeltaChunk,
  ToolCallReadyChunk,
  ToolResultChunk,
  DoneChunk,
  ErrorChunk,
  ToolCallState,
  StreamMessage,
} from "./types";
