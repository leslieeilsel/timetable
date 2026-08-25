import { defineConfig, devices } from "@playwright/test"

const e2ePassword = process.env.E2E_ADMIN_PASSWORD ?? "E2eTemporary1234"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "sh infra/scripts/start-e2e-api.sh",
      url: "http://127.0.0.1:8001/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { ...process.env, E2E_ADMIN_PASSWORD: e2ePassword },
    },
    {
      command:
        "VITE_API_TARGET=http://127.0.0.1:8001 vp run @timetable/web#dev -- --host=localhost --port=5174",
      url: "http://localhost:5174/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
