import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.skip(
  process.env.TEST_PHASE === "restart",
  "Голос проверяется до отдельной фазы перезапуска текста",
);
if (process.env.APP_ENV !== "test")
  throw new Error("Только тестовое окружение");
async function register(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page
    .getByLabel("Логин", { exact: true })
    .fill(`voice_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  await page.getByLabel("Отображаемое имя").fill(name);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("voice_browser_password_123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(
    page.getByRole("button", { name: "Настройки профиля" }),
  ).toBeVisible();
}
async function api(context: BrowserContext) {
  return async (path: string, method = "GET", data?: unknown) => {
    const csrf =
      (await context.cookies()).find((cookie) => cookie.name === "hub_csrf")
        ?.value ?? "";
    const response = await context.request.fetch(`/api${path}`, {
      method,
      data,
      headers: { Origin: process.env.TEST_BASE_URL!, "X-Hub-CSRF": csrf },
    });
    expect(response.ok(), `${method} ${path}`).toBe(true);
    return response.json();
  };
}
test("настоящий LiveKit: звук, микрофон, deafen, смена текста/голоса, kick и удаление", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const a = await browser.newContext();
  const b = await browser.newContext();
  await a.grantPermissions(["microphone"]);
  await b.grantPermissions(["microphone"]);
  // Optional isolated TURN probe retains real credentials, SDP and audio.
  // Only the TLS edge is bypassed: the runner connects to the private post-TLS listener.
  for (const context of [a, b])
    await context.addInitScript((forceRelay) => {
      const Native = window.RTCPeerConnection;
      const peers: RTCPeerConnection[] = [];
      Object.assign(window, { hubTestPeers: peers });
      const relayConfig = (config: RTCConfiguration = {}): RTCConfiguration =>
        forceRelay
          ? {
              ...config,
              iceTransportPolicy: "relay",
              iceServers: config.iceServers
                ?.filter((server) => String(server.urls).includes("turn"))
                .map((server) => ({
                  ...server,
                  urls: "turn:turn-proxy:5349?transport=tcp",
                })),
            }
          : config;
      window.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(relayConfig(config));
          peers.push(this);
        }
        override setConfiguration(config: RTCConfiguration) {
          super.setConfiguration(relayConfig(config));
        }
      };
    }, process.env.TEST_FORCE_RELAY === "true");
  const alice = await a.newPage();
  const bob = await b.newPage();
  const errors: string[] = [];
  for (const page of [alice, bob])
    page.on("pageerror", (e) => errors.push(e.message));
  for (const context of [a, b])
    await context.addInitScript(() => {
      const inputs: MediaStreamTrack[] = [];
      Object.assign(window, { hubTestInputs: inputs });
      const microphone = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (options) => {
        const stream = await microphone(options);
        inputs.push(...stream.getAudioTracks());
        return stream;
      };
      const capture = navigator.mediaDevices.getDisplayMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const stream = await capture(options);
        Object.assign(window, { hubTestScreen: stream });
        return stream;
      };
    });
  await register(alice, "Алиса голос");
  await register(bob, "Борис голос");
  const callA = await api(a);
  const callB = await api(b);
  const community = await callA("/communities", "POST", {
    name: "Живой голос",
  });

  const voice = await callA(`/communities/${community.id}/channels`, "POST", {
    name: "Разговор",
    type: "VOICE",
  });
  const other = await callA(`/communities/${community.id}/channels`, "POST", {
    name: "Другой разговор",
    type: "VOICE",
  });
  const invite = await callA(`/communities/${community.id}/invites`, "POST", {
    hours: 1,
    maxUses: 2,
  });
  await callB("/invites/join", "POST", { token: invite.url.split("/").at(-1) });
  await alice.goto(`/c/${community.id}/ch/${voice.id}`);
  await alice.getByRole("button", { name: "Настройки сообщества" }).click();
  const memberRow = alice
    .locator(".member-settings")
    .filter({ hasText: "Борис голос" });
  await memberRow
    .getByRole("button", { name: "Назначить совладельцем" })
    .click();
  await expect(memberRow).toContainText("Совладелец");
  await alice.keyboard.press("Escape");
  await bob.goto(`/c/${community.id}/ch/${voice.id}`);
  await bob.getByRole("button", { name: "Настройки сообщества" }).click();
  await expect(bob.getByLabel("Новый канал", { exact: true })).toBeVisible();
  await expect(
    bob.getByRole("button", { name: "Удалить сообщество", exact: true }),
  ).toHaveCount(0);
  await expect(
    bob.getByRole("button", { name: "Передать владение", exact: true }),
  ).toHaveCount(0);
  await expect(
    bob.getByRole("button", { name: "Назначить совладельцем", exact: true }),
  ).toHaveCount(0);
  await bob.keyboard.press("Escape");
  for (const page of [alice, bob]) {
    await page.goto(`/c/${community.id}/ch/${voice.id}`);
    await page
      .getByRole("button", { name: "Подключиться к голосу", exact: true })
      .click();
    await expect(page.getByTestId("voice-state")).toHaveText(
      "Голос подключён",
      { timeout: 30000 },
    );
  }
  await expect(alice.getByTestId("voice-participant")).toHaveCount(2);
  await expect(bob.getByTestId("voice-participant")).toHaveCount(2);
  const card = alice
    .getByTestId("voice-participant")
    .filter({ hasText: "Алиса голос" });
  const beforeSize = await card.boundingBox();
  await expect(alice.getByText("Говорит", { exact: true })).toHaveCount(0);
  await alice
    .getByRole("button", { name: "Включить микрофон", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Выключить микрофон", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        bob.evaluate(async () => {
          const peers = (
            window as unknown as { hubTestPeers: RTCPeerConnection[] }
          ).hubTestPeers;
          let bytes = 0;
          for (const peer of peers)
            (await peer.getStats()).forEach((stat) => {
              if (stat.type === "inbound-rtp" && stat.kind === "audio")
                bytes += stat.bytesReceived ?? 0;
            });
          return bytes;
        }),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  if (process.env.TEST_FORCE_RELAY === "true") {
    for (const page of [alice, bob]) {
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const peers = (
                window as unknown as { hubTestPeers: RTCPeerConnection[] }
              ).hubTestPeers;
              let selected = 0;
              for (const peer of peers) {
                if (peer.connectionState !== "connected") continue;
                if (peer.getConfiguration().iceTransportPolicy !== "relay")
                  return false;
                const stats = await peer.getStats();
                for (const stat of stats.values())
                  if (
                    stat.type === "transport" &&
                    stat.selectedCandidatePairId
                  ) {
                    const pair = stats.get(stat.selectedCandidatePairId);
                    const candidate = stats.get(pair.localCandidateId);
                    // Embedded TURN advertises public node_ip; its private SFU path
                    // can produce a peer-reflexive local candidate derived from relay.
                    // The runner is on a different Docker network and cannot reach SFU directly.
                    if (!["relay", "prflx"].includes(candidate.candidateType))
                      return false;
                    selected++;
                  }
              }
              return selected > 0;
            }),
          { timeout: 15000 },
        )
        .toBe(true);
    }
  }
  await expect(bob.locator('[data-speaking="true"]')).not.toHaveCount(0, {
    timeout: 15000,
  });
  await bob
    .getByRole("button", { name: "Громкость: Алиса голос", exact: true })
    .click();
  await bob
    .getByRole("slider", { name: /Громкость пользователя/ })
    .press("Home");
  await expect
    .poll(() =>
      bob.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ].every((audio) => audio.volume === 0),
      ),
    )
    .toBe(true);
  await bob
    .getByRole("button", { name: "Сбросить громкость", exact: true })
    .click();
  await expect
    .poll(() =>
      bob.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ].some((audio) => audio.volume === 1),
      ),
    )
    .toBe(true);
  await bob.keyboard.press("Escape");
  await bob
    .getByRole("button", { name: "Отключить воспроизведение", exact: true })
    .click();
  await expect
    .poll(() =>
      bob.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ].every((a) => a.muted),
      ),
    )
    .toBe(true);
  await bob
    .getByRole("button", { name: "Выйти из голоса", exact: true })
    .click();
  await bob
    .getByRole("button", { name: "Подключиться к голосу", exact: true })
    .click();
  await expect(bob.getByTestId("voice-state")).toHaveText("Голос подключён");
  await expect
    .poll(() =>
      bob.evaluate(() => {
        const elements = [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ];
        return elements.length > 0 && elements.every((e) => e.muted);
      }),
    )
    .toBe(true);
  await bob
    .getByRole("button", { name: "Включить воспроизведение", exact: true })
    .click();
  await expect
    .poll(() =>
      bob.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ].some((a) => !a.muted),
      ),
    )
    .toBe(true);
  const afterSize = await card.boundingBox();
  expect(afterSize?.height).toBe(beforeSize?.height);
  expect(afterSize?.width).toBe(beforeSize?.width);
  await alice
    .getByRole("button", { name: "Настройки голоса", exact: true })
    .click();
  await expect(alice.getByLabel("Шумоподавление", { exact: true })).toHaveValue(
    "standard",
  );
  await bob
    .getByRole("button", { name: "Настройки голоса", exact: true })
    .click();
  const output = bob.getByLabel("Устройство вывода", { exact: true });
  const outputId = await output.locator("option").last().getAttribute("value");
  expect(outputId).toBeTruthy();
  await output.selectOption(outputId!);
  await expect
    .poll(() =>
      bob.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ].map((audio) => audio.sinkId),
      ),
    )
    .toContain(outputId);
  await bob.keyboard.press("Escape");
  await alice.getByLabel("Шумоподавление", { exact: true }).selectOption("off");
  expect(
    await alice.evaluate(
      () =>
        JSON.parse(localStorage.getItem("hub.audio.v2")!).noiseSuppressionMode,
    ),
  ).toBe("off");
  await expect(
    alice.getByLabel("Шумоподавление", { exact: true }),
  ).toBeEnabled();
  await alice.keyboard.press("Escape");
  await expect(alice.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      alice.evaluate(() => {
        const peers = (
          window as unknown as { hubTestPeers: RTCPeerConnection[] }
        ).hubTestPeers;
        void peers;
        return (
          window as unknown as { hubTestInputs: MediaStreamTrack[] }
        ).hubTestInputs
          .at(-1)
          ?.getSettings().noiseSuppression;
      }),
    )
    .toBe(false);
  await alice
    .getByRole("button", { name: "Демонстрация экрана", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Остановить демонстрацию", exact: true }),
  ).toBeVisible();
  await bob
    .getByRole("button", { name: "Смотреть экран: Алиса голос" })
    .click();
  await expect
    .poll(
      () =>
        bob
          .getByTestId("screen-video")
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await expect(bob.getByTestId("screen-video")).toHaveCSS(
    "object-fit",
    "contain",
  );
  expect(
    await bob
      .getByTestId("screen-video")
      .evaluate(
        (video) => video.getBoundingClientRect().bottom <= window.innerHeight,
      ),
  ).toBe(true);
  await bob.screenshot({ path: "artifacts/screen-desktop.png" });
  await bob
    .getByRole("button", { name: "Демонстрация экрана", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Смотреть экран: Борис голос" }),
  ).toBeVisible();
  await alice
    .getByRole("button", { name: "Смотреть экран: Борис голос" })
    .click();
  await expect
    .poll(
      () =>
        alice
          .getByTestId("screen-video")
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await alice
    .getByRole("button", { name: "Остановить демонстрацию", exact: true })
    .click();
  await expect(
    bob.getByRole("button", { name: "Смотреть экран: Алиса голос" }),
  ).toHaveCount(0);
  await alice
    .getByRole("button", { name: "Демонстрация экрана", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Остановить демонстрацию", exact: true }),
  ).toBeVisible();
  await alice.evaluate(() => {
    const stream = (window as unknown as { hubTestScreen: MediaStream })
      .hubTestScreen;
    for (const track of stream.getTracks()) {
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
  await expect(
    alice.getByRole("button", { name: "Демонстрация экрана", exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Закрыть просмотр" }).click();
  await bob.getByRole("button", { name: "Закрыть просмотр" }).click();
  await alice.screenshot({ path: "artifacts/voice-desktop.png" });
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(
    alice.getByRole("button", { name: "Выключить микрофон", exact: true }),
  ).toBeVisible();
  expect(
    await alice.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await alice.screenshot({ path: "artifacts/voice-mobile.png" });
  await alice.setViewportSize({ width: 1280, height: 720 });
  await alice
    .getByRole("button", { name: "Выключить микрофон", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Включить микрофон", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveAttribute("data-speaking", "false");
  const mutedSize = await card.boundingBox();
  expect(mutedSize?.height).toBe(beforeSize?.height);
  expect(mutedSize?.width).toBe(beforeSize?.width);
  await bob
    .getByRole("button", { name: "Громкость: Алиса голос", exact: true })
    .click();
  await bob
    .getByRole("slider", { name: /Громкость пользователя/ })
    .press("Home");
  await bob.keyboard.press("Escape");
  // Initial Hub JWT expires in 60s. The real SFU must refresh it before reconnect.
  await new Promise((resolve) => setTimeout(resolve, 65000));
  await b.setOffline(true);
  await expect(bob.getByTestId("voice-state")).toHaveText(
    "Голос: переподключение…",
    { timeout: 30000 },
  );
  await b.setOffline(false);
  await expect(bob.getByTestId("voice-state")).toHaveText("Голос подключён", {
    timeout: 30000,
  });
  await expect(bob.getByTestId("voice-participant")).toHaveCount(2);
  // A muted publication may not resubscribe until the sender resumes it.
  await alice
    .getByRole("button", { name: "Включить микрофон", exact: true })
    .click();
  await expect
    .poll(() =>
      bob.evaluate(() => {
        const audio = [
          ...document.querySelectorAll<HTMLAudioElement>(
            "audio[data-hub-voice-audio]",
          ),
        ];
        return [...new Set(audio.map((element) => element.volume))];
      }),
    )
    .toEqual([0]);
  await alice.getByRole("button", { name: "# общий", exact: true }).click();
  await expect(alice.getByTestId("voice-state")).toHaveText("Голос подключён");
  await expect(bob.getByTestId("voice-participant")).toHaveCount(2);
  await alice
    .getByRole("button", { name: "◉ Другой разговор", exact: true })
    .click();
  await alice
    .getByRole("button", { name: "Перейти в этот голосовой канал" })
    .click();
  await expect(alice.getByTestId("voice-state")).toHaveText("Голос подключён");
  await expect(bob.getByTestId("voice-participant")).toHaveCount(1);
  const member = await callB("/auth/me");
  await callA(`/communities/${community.id}/members/${member.id}`, "DELETE");
  await expect(bob.getByTestId("voice-participant")).toHaveCount(0);
  await expect
    .poll(() =>
      bob.evaluate(() =>
        (window as unknown as { hubTestScreen: MediaStream }).hubTestScreen
          .getTracks()
          .every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  await callA(`/communities/${community.id}/channels/${other.id}`, "DELETE");
  await expect(alice.getByTestId("voice-participant")).toHaveCount(0);
  await alice.goto(`/c/${community.id}/ch/${voice.id}`);
  await alice
    .getByRole("button", { name: "Подключиться к голосу", exact: true })
    .click();
  await expect(alice.getByTestId("voice-state")).toHaveText("Голос подключён");
  await a.clearPermissions();
  await a.grantPermissions([]);
  await alice
    .getByRole("button", { name: "Включить микрофон", exact: true })
    .click();
  await expect(alice.getByRole("alert")).toContainText(
    "Доступ к микрофону запрещён",
  );
  await alice
    .getByRole("button", { name: "Демонстрация экрана", exact: true })
    .click();
  await expect(
    alice.getByRole("button", { name: "Остановить демонстрацию", exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Настройки профиля" }).click();
  await alice.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(alice.getByTestId("voice-participant")).toHaveCount(0);
  await expect
    .poll(() =>
      alice.evaluate(() =>
        (window as unknown as { hubTestScreen: MediaStream }).hubTestScreen
          .getTracks()
          .every((t) => t.readyState === "ended"),
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
