import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma's generated client statically requires WASM fallback engines for
  // every database provider it supports (mysql/sqlite/sqlserver/cockroachdb),
  // not just the postgresql one this app actually uses. Next's output file
  // tracer includes all of them in every function bundle even though this
  // app only ever loads the native query engine (see prisma/schema.prisma:
  // datasource db { provider = "postgresql" }, no driver adapter configured).
  // Excluding the unused providers' engine/compiler files trims that dead
  // weight without touching the native engine or the postgresql files.
  outputFileTracingExcludes: {
    "**/*": [
      "node_modules/@prisma/client/runtime/query_engine_bg.{mysql,sqlite,sqlserver,cockroachdb}.{js,mjs,wasm-base64.js,wasm-base64.mjs}",
      "node_modules/@prisma/client/runtime/query_compiler_bg.{mysql,sqlite,sqlserver,cockroachdb}.{js,mjs,wasm-base64.js,wasm-base64.mjs}",
    ],
  },
};

export default nextConfig;
