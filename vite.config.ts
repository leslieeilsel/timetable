import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    singleQuote: false,
    semi: false,
  },
  lint: {
    plugins: ["typescript"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["apps/web/**"],
        plugins: ["react"],
      },
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
        plugins: ["vitest"],
      },
    ],
  },
})
