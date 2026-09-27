import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
  resolve: {
    alias: { "@shared": resolve(__dirname, "src/shared") },
  },
});
