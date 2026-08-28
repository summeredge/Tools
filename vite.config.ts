import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [sites()],
  build: {
    outDir: "dist/client",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
