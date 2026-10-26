import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
test("диалог: фон, содержимое, Escape, focus и отмена удаления", async ({
  page,
}) => {
  test.skip(process.env.TEST_PHASE === "restart");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page
    .getByLabel("Логин", { exact: true })
    .fill(`m_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  await page.getByLabel("Отображаемое имя").fill("Диалог");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("modal_test_password_123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  const profile = page.getByRole("button", { name: "Настройки профиля" });
  await profile.click();
  await page.getByRole("dialog").getByRole("heading").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(profile).toBeFocused();
  await profile.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(profile).toBeFocused();
  await page
    .getByRole("button", { name: "Создать сообщество", exact: true })
    .last()
    .click();
  await page
    .getByLabel("Название сообщества", { exact: true })
    .fill("Сохранить сообщество");
  await page.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByRole("button", { name: "Настройки сообщества" }).click();
  await page
    .getByRole("button", { name: "Удалить сообщество", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Подтвердить", exact: true }),
  ).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Настройки сообщества" }).click();
  await expect(
    page.getByLabel("Название сообщества", { exact: true }),
  ).toHaveValue("Сохранить сообщество");
});
