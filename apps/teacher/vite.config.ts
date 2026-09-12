import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"
import { defineConfig, lazyPlugins } from "vite-plus"

export default defineConfig({
  fmt: {},
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    // The admin console owns 5173 and `vp run dev` starts both apps, so the teacher H5 keeps its
    // own port instead of contending for the e2e port 5174 that the admin console also uses.
    port: Number(process.env.TEACHER_WEB_PORT ?? 5175),
    strictPort: true,
    proxy: {
      "/api": process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
      "/sanctum": process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.TEACHER_WEB_PORT ?? 5175) + 1_000,
    proxy: {
      "/api": process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
      "/sanctum": process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
    },
  },
})
