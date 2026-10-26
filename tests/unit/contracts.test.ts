import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteMessage,
  canKick,
  canManage,
  credentials,
  messageInput,
  registration,
  type Role,
} from "../../packages/shared/src";
const roles: Role[] = ["OWNER", "ADMIN", "MEMBER"];
test("матрица управления, исключения и удаления сообщений", () => {
  assert.deepEqual(roles.map(canManage), [true, true, false]);
  assert.deepEqual(
    roles.flatMap((a) => roles.map((b) => canKick(a, b))),
    [false, true, true, false, false, true, false, false, false],
  );
  assert.deepEqual(
    roles.flatMap((a) => roles.map((b) => canDeleteMessage(a, b, false))),
    [true, true, true, false, false, true, false, false, false],
  );
  for (const role of roles)
    assert.equal(canDeleteMessage(role, "OWNER", true), true);
});
test("нормализация логина, кириллица в имени, запрет подмены роли", () => {
  const input = {
    username: "  Alice_123 ",
    password: "long_password_123",
    displayName: "Алиса",
  };
  assert.equal(registration.parse(input).username, "alice_123");
  assert.equal(registration.parse(input).displayName, "Алиса");
  assert.equal(
    registration.safeParse({ ...input, role: "OWNER" }).success,
    false,
  );
  assert.equal(
    credentials.safeParse({ username: "Алиса", password: input.password })
      .success,
    false,
  );
  assert.equal(
    credentials.safeParse({ username: "alice", password: "short" }).success,
    false,
  );
});
test("ограничения текста и идентификатора отправки", () => {
  assert.equal(
    messageInput.safeParse({
      content: "x".repeat(4001),
      clientId: crypto.randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    messageInput.safeParse({ content: "  ", clientId: crypto.randomUUID() })
      .success,
    false,
  );
  assert.equal(
    messageInput.parse({
      content: "<script>alert(1)</script>",
      clientId: crypto.randomUUID(),
    }).content,
    "<script>alert(1)</script>",
  );
});
