import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 実 API へは接続しない。fetch モック / Fake ApiClient によるユニットテスト中心。
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // expectTypeOf / @ts-expect-error による型テストを実際に検証する
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.test.json",
      include: ["tests/**/*.test.ts"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // 再エクスポートのみの index.ts と、型のみで実行コードを持たない types.ts は除外する
      exclude: ["src/index.ts", "src/types.ts"],
      reporter: ["text", "html"],
      thresholds: {
        // MVP 目安: statements 80%
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
