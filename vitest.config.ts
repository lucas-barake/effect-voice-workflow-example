import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "packages/*/src/**/*.ts",
        "packages/*/src/**/*.tsx",
      ],
      exclude: [
        "**/*.d.ts",
        "**/routeTree.gen.ts",
        "packages/server/build/**",
        "packages/oxlint-rules/**",
        "vitest.shared.ts",
      ],
    },
    projects: ["packages/*"],
  },
});
