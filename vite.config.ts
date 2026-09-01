import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/api/zhihu-hot": {
        target: "https://api.xunjinlu.fun",
        changeOrigin: true,
        rewrite: () => "/api/rebang/zhihu.php",
      },
    },
  },
  build: {
    outDir: "dist/client",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
