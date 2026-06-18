import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "adapters/vercel-ai-sdk": "src/adapters/vercel-ai-sdk.ts",
    "adapters/openai": "src/adapters/openai.ts",
    "adapters/anthropic": "src/adapters/anthropic.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  treeshake: true,
});
