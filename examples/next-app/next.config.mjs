import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["streamkit"],
  // This example lives in a monorepo-style layout (streamkit root + nested
  // lockfiles). Pin the file-tracing root to the repo root so Next stops
  // warning about inferring it from multiple lockfiles, and so output tracing
  // resolves the linked `streamkit` package correctly on deploy.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
