import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:8080",
    headless: true,
    launchOptions: {
      args:
        process.env.APP_ENV === "test"
          ? [
              "--use-fake-device-for-media-stream",
              "--auto-select-desktop-capture-source=Entire screen",
              "--use-fake-ui-for-media-stream",
              "--use-file-for-fake-audio-capture=/tmp/hub-voice.wav",
            ]
          : [],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
