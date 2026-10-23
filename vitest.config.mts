import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts"],
    // PGlite 초기화(마이그레이션 적용)에 시간이 걸린다.
    testTimeout: 30_000,
  },
});
