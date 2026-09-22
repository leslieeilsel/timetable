import { defineConfig } from "vite-plus"

export default defineConfig({
  build: {
    ssr: "src/server.ts",
    target: "node24",
    outDir: "dist",
    rollupOptions: { output: { entryFileNames: "server.js" } },
  },
  ssr: { noExternal: ["@timetable/agent-contracts"] },
  test: { include: ["tests/**/*.test.ts"] },
})
