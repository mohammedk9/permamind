import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next resolves this marker through its own plugin; Vite has to be told what it is.
      // Without this, any test that imports a `server-only` module for real fails to resolve.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  css: {
    postcss: {},
  },
  // The automatic JSX runtime, matching `tsconfig.json`'s `"jsx": "preserve"` as Next.js
  // resolves it at build time.
  //
  // Without this Vite uses the classic transform, which requires `React` to be in scope in
  // every file containing JSX. That is why every component with a test imports it explicitly
  // — and why `ui/button.tsx`, which predates this and is imported by those tests, throws
  // "React is not defined" the moment a test renders it directly. Setting the runtime here
  // fixes the whole class rather than adding another import to one more file.
  esbuild: { jsx: "automatic" },
});