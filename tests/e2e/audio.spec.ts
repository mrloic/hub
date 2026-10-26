import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.skip(process.env.TEST_PHASE === "restart");
if (process.env.APP_ENV !== "test")
  throw new Error("Только тестовый экземпляр");
test("локальный RNNoise Worklet: init, meter, gain/PTT, настройки и fallback", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ permissions: ["microphone"] });
  await context.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { hubAudioInputs: tracks });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await native(constraints);
      tracks.push(...stream.getAudioTracks());
      return stream;
    };
    const Native = window.RTCPeerConnection;
    Object.assign(window, { hubPeers: 0 });
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        (window as unknown as { hubPeers: number }).hubPeers++;
      }
    };
  });
  const page = await context.newPage();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page
    .getByLabel("Логин", { exact: true })
    .fill(`d_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  await page.getByLabel("Отображаемое имя").fill("Аудио тест");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("audio_fixture_password_123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await page.getByRole("button", { name: "Голос и устройства" }).click();
  await page.screenshot({ path: "artifacts/audio-devices.png" });
  await page
    .getByLabel("Шумоподавление", { exact: true })
    .selectOption("rnnoise");
  await page
    .getByRole("button", { name: "Проверить микрофон", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Остановить проверку", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByLabel("Шумоподавление", { exact: true })).toHaveValue(
    "rnnoise",
  );
  await expect
    .poll(async () =>
      Number(await page.getByRole("meter").getAttribute("aria-valuenow")),
    )
    .toBeGreaterThan(-75);
  expect(
    await page.evaluate(
      () => (window as unknown as { hubPeers: number }).hubPeers,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { hubAudioInputs: MediaStreamTrack[] }
        ).hubAudioInputs
          .at(-1)!
          .getSettings().noiseSuppression,
    ),
  ).toBe(false);
  const input = page.getByLabel("Устройство ввода", { exact: true });
  const alternate = await input.locator("option").last().getAttribute("value");
  expect(alternate).toBeTruthy();
  await input.selectOption(alternate!);
  await expect(input).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { hubAudioInputs: MediaStreamTrack[] }
          ).hubAudioInputs
            .at(-1)
            ?.getSettings().deviceId,
      ),
    )
    .toBe(alternate);
  await page.getByRole("slider", { name: /Громкость микрофона/ }).press("Home");
  await expect(
    page.getByRole("slider", { name: /Громкость микрофона/ }),
  ).toHaveValue("0");
  await page.getByLabel("Режим ввода").selectOption("ptt");
  await page.getByLabel("Клавиша Push-to-Talk").fill("F8");
  await page
    .getByRole("button", { name: "Остановить проверку", exact: true })
    .focus();
  await expect(page.getByText(/Затвор закрыт/)).toBeVisible();
  await page.keyboard.down("F8");
  await expect(page.getByText(/Передача разрешена/)).toBeVisible();
  await page.keyboard.up("F8");
  await expect(page.getByText(/Затвор закрыт/)).toBeVisible();
  await page.screenshot({ path: "artifacts/audio-settings.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { hubAudioInputs: MediaStreamTrack[] }
        ).hubAudioInputs.every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  // Actual WASM initialization failure: Chromium refuses WebAssembly compilation
  // under a stricter CSP. The ordinary Worklet remains permitted for fallback.
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    headers["content-security-policy"] = headers[
      "content-security-policy"
    ].replace(" 'wasm-unsafe-eval'", "");
    await route.fulfill({ response, headers });
  });
  await page.reload();
  await page.getByRole("button", { name: "Голос и устройства" }).click();
  await expect(
    page.getByRole("slider", { name: /Громкость микрофона/ }),
  ).toHaveValue("0");
  await expect(page.getByLabel("Шумоподавление", { exact: true })).toHaveValue(
    "rnnoise",
  );
  await page
    .getByRole("button", { name: "Проверить микрофон", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Остановить проверку", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByLabel("Шумоподавление", { exact: true })).toHaveValue(
    "standard",
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { hubAudioInputs: MediaStreamTrack[] }
        ).hubAudioInputs
          .at(-1)
          ?.getSettings().noiseSuppression,
    ),
  ).toBe(true);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Включена стандартная",
  );
  await page
    .getByRole("button", { name: "Остановить проверку", exact: true })
    .click();
  await context.close();
});
