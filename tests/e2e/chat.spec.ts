import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
if (process.env.APP_ENV !== "test")
  throw new Error("E2E разрешены только в отдельном тестовом окружении.");
const directory = "/tmp/hub-e2e";
async function register(page: Page, displayName: string) {
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page
    .getByLabel("Логин", { exact: true })
    .fill(`u_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  await page.getByLabel("Отображаемое имя").fill(displayName);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("browser_password_12345");
  await page
    .getByRole("button", { name: "Зарегистрироваться", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Настройки профиля" }),
  ).toBeVisible();
}
test("два пользователя: приглашение, живой чат, правка, удаление, reconnect, маршруты", async ({
  browser,
}) => {
  test.skip(process.env.TEST_PHASE === "restart");
  const first = await browser.newContext();
  const second = await browser.newContext();
  const alice = await first.newPage();
  const bob = await second.newPage();
  const errors: string[] = [];
  for (const page of [alice, bob]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !/net::ERR_|401|403|Failed to load resource/.test(message.text())
      )
        errors.push(message.text());
    });
  }
  await alice.goto("/");
  await register(alice, "Алиса");
  await expect(alice.getByRole("status")).toHaveText("На связи");
  await alice
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .last()
    .click();
  await alice
    .getByLabel("Название сообщества", { exact: true })
    .fill("Команда Hub");
  await alice.getByRole("button", { name: "Создать", exact: true }).click();
  await alice.getByRole("button", { name: "Настройки сообщества" }).click();
  await alice.getByLabel("Новый канал").fill("разработка");
  await alice
    .getByRole("button", { name: "Создать канал", exact: true })
    .click();
  await alice.getByRole("button", { name: "Создать приглашение" }).click();
  const invitation = await alice
    .getByLabel("Ссылка-приглашение", { exact: true })
    .inputValue();
  await alice.getByRole("button", { name: "Закрыть диалог" }).click();
  await alice
    .getByRole("button", { name: "# разработка", exact: true })
    .click();
  await bob.goto(invitation);
  await register(bob, "Борис");
  await bob
    .getByRole("dialog")
    .getByRole("button", { name: "Присоединиться", exact: true })
    .click();
  await bob.getByRole("button", { name: "# разработка", exact: true }).click();
  await alice.getByLabel("Сообщение", { exact: true }).fill("Привет, Борис!");
  await alice.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(bob.getByText("Привет, Борис!", { exact: true })).toBeVisible();
  await bob.getByLabel("Сообщение", { exact: true }).fill("Привет, Алиса!");
  await bob.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    alice.getByText("Привет, Алиса!", { exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Редактировать сообщение" }).click();
  await alice.getByLabel("Текст", { exact: true }).fill("Привет, команда!");
  await alice.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    bob.getByText("Привет, команда!", { exact: true }),
  ).toBeVisible();
  await alice
    .locator("article")
    .filter({ hasText: "Привет, команда!" })
    .getByRole("button", { name: "Удалить сообщение" })
    .click();
  await expect(
    bob.getByText("Сообщение удалено", { exact: true }),
  ).toBeVisible();
  await expect(
    alice.getByText("Сообщение удалено", { exact: true }),
  ).toBeVisible();
  await bob.reload();
  await expect(bob.getByText("Привет, Алиса!", { exact: true })).toBeVisible();
  for (const text of ["Правка без связи", "Удаление без связи"]) {
    await alice.getByLabel("Сообщение", { exact: true }).fill(text);
    await alice.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(bob.getByText(text, { exact: true })).toBeVisible();
  }
  await second.setOffline(true);
  await alice
    .getByLabel("Сообщение", { exact: true })
    .fill("<script>window.hubXss = true</script>");
  await alice.getByRole("button", { name: "Отправить", exact: true }).click();
  await alice
    .locator("article")
    .filter({ hasText: "Правка без связи" })
    .getByRole("button", { name: "Редактировать сообщение" })
    .click();
  await alice
    .getByLabel("Текст", { exact: true })
    .fill("Правка после reconnect");
  await alice.getByRole("button", { name: "Сохранить", exact: true }).click();
  await alice
    .locator("article")
    .filter({ hasText: "Удаление без связи" })
    .getByRole("button", { name: "Удалить сообщение" })
    .click();
  await second.setOffline(false);
  await expect(
    bob.getByText("<script>window.hubXss = true</script>", { exact: true }),
  ).toBeVisible();
  expect(await bob.evaluate(() => "hubXss" in window)).toBe(false);
  await expect(
    bob.getByText("Правка после reconnect", { exact: true }),
  ).toBeVisible();
  await expect(
    bob.getByText("Удаление без связи", { exact: true }),
  ).toHaveCount(0);

  await second.setOffline(true);
  await bob
    .getByLabel("Сообщение", { exact: true })
    .fill("Повтор после разрыва");
  await bob.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    bob.getByRole("button", { name: "Повторить отправку" }),
  ).toBeVisible();
  await second.setOffline(false);
  await bob.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(
    alice.getByText("Повтор после разрыва", { exact: true }),
  ).toBeVisible();
  const url = alice.url();
  await alice.goto(url);
  await expect(
    alice.getByText("Привет, Алиса!", { exact: true }),
  ).toBeVisible();
  await alice.getByRole("button", { name: "Показать участников" }).click();
  await mkdir("artifacts", { recursive: true });
  await alice.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await expect(bob.getByRole("status")).toHaveText("На связи");
  await expect(bob.getByRole("alert")).toHaveCount(0);
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  expect(
    await bob.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(directory, { recursive: true });
  await first.storageState({ path: `${directory}/state.json` });
  await writeFile(`${directory}/url.txt`, url);
  expect(errors).toEqual([]);
  await first.close();
  await second.close();
});
test("данные и серверная сессия сохранены после перезапуска PostgreSQL/API/Caddy", async ({
  browser,
}) => {
  test.skip(process.env.TEST_PHASE !== "restart");
  const context = await browser.newContext({
    storageState: `${directory}/state.json`,
  });
  const page = await context.newPage();
  await page.goto(await readFile(`${directory}/url.txt`, "utf8"));
  await expect(
    page.getByRole("button", { name: "Настройки профиля" }),
  ).toBeVisible();
  await expect(page.getByText("Привет, Алиса!", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Сообщение удалено", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Повтор после разрыва", { exact: true }),
  ).toBeVisible();
  await context.close();
});

test("пагинация сохраняет видимый текст и новые сообщения не тянут вниз", async ({
  browser,
}) => {
  test.skip(process.env.TEST_PHASE === "restart");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await register(page, "Читатель");
  const csrf = (await (await context.request.get("/api/auth/csrf")).json())
    .csrf;
  const headers = {
    Origin: new URL(process.env.TEST_BASE_URL!).origin,
    "X-Hub-CSRF": csrf,
  };
  const community = await (
    await context.request.post("/api/communities", {
      headers,
      data: { name: "История" },
    })
  ).json();
  const detail = await (
    await context.request.get(`/api/communities/${community.id}`)
  ).json();
  const channel = detail.channels[0].id;
  for (let i = 1; i <= 55; i++) {
    const response = await context.request.post(
      `/api/channels/${channel}/messages`,
      {
        headers,
        data: {
          clientId: randomUUID(),
          content: `Строка ${String(i).padStart(2, "0")}`,
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await page.goto(`/c/${community.id}/ch/${channel}`);
  await expect(page.getByText("Строка 55", { exact: true })).toBeVisible();
  const area = page.getByLabel("Переписка", { exact: true });
  await area.evaluate((el) => {
    el.scrollTop = 0;
  });
  const anchor = page.getByText("Строка 06", { exact: true });
  const before = (await anchor.boundingBox())!.y;
  await page
    .getByRole("button", { name: "Загрузить старые сообщения" })
    .click();
  await expect(page.getByText("Строка 01", { exact: true })).toBeAttached();
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(4);
  await context.request.post(`/api/channels/${channel}/messages`, {
    headers,
    data: { clientId: randomUUID(), content: "Новое внизу" },
  });
  await expect(page.getByText("Новое внизу", { exact: true })).toBeAttached();
  expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(4);
  await context.close();
});
