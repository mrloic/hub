import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import pg from "pg";
const base = process.env.TEST_BASE_URL;
if (
  !base ||
  !process.env.DATABASE_URL?.endsWith("/hub_test") ||
  process.env.APP_ENV !== "test"
)
  throw new Error(
    "Интеграционные тесты разрешены только в изолированной hub_test (scripts/test.sh).",
  );
const origin = new URL(base).origin;
class Client {
  jar: Record<string, string> = {};
  csrf = "";
  userId = "";
  username = "";
  get cookie() {
    return Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  async raw(
    path: string,
    method = "GET",
    data?: unknown,
    headers?: Record<string, string>,
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        cookie: this.cookie,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Hub-CSRF": this.csrf,
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0].split("=");
      this.jar[pair[0]] = pair[1];
    }
    return response;
  }
  async call(path: string, method = "GET", data?: unknown) {
    const response = await this.raw(path, method, data);
    assert.ok(
      response.ok,
      `${method} ${path}: ${response.status} ${!response.ok ? await response.text() : ""}`,
    );
    return response.json();
  }
  async register() {
    this.csrf = (await this.call("/auth/csrf")).csrf;
    const user = await this.call("/auth/register", "POST", {
      username: `u_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      displayName: "Тестовый участник",
      password: "test_password_123456",
    });
    this.userId = user.id;
    this.username = user.username;
    return this;
  }
  socket(extra: Record<string, string> = {}): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(base!, {
        transports: ["websocket"],
        extraHeaders: { Cookie: this.cookie, Origin: origin, ...extra },
        reconnection: false,
        timeout: 3000,
      });
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (e) => {
        socket.close();
        reject(e);
      });
    });
  }
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "настоящий API/PostgreSQL: роли, гонки, сообщения, сессии, socket и ограничения",
  { timeout: 90000 },
  async (t) => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM "RateLimit"');
    t.after(() => pool.end());
    const owner = await new Client().register();
    const member = await new Client().register();
    const third = await new Client().register();
    const fourth = await new Client().register();
    const community = await owner.call("/communities", "POST", {
      name: "Интеграционное сообщество",
    });
    const cid = community.id;
    const detail = await owner.call(`/communities/${cid}`);
    const chid = detail.channels[0].id;
    const path = `/channels/${chid}/messages`;
    await t.test(
      "CSRF, Origin, запрет полей и доступа постороннего",
      async () => {
        assert.equal((await third.raw(`/communities/${cid}`)).status, 403);
        assert.equal((await third.raw(path)).status, 403);
        assert.equal(
          (
            await owner.raw(
              "/communities",
              "POST",
              { name: "Нет" },
              { "X-Hub-CSRF": "" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await owner.raw(
              "/communities",
              "POST",
              { name: "Нет" },
              { Origin: "https://evil.invalid" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await owner.raw("/communities", "POST", {
              name: "Нет",
              role: "OWNER",
            })
          ).status,
          400,
        );
        await assert.rejects(() =>
          third.socket({ Origin: "https://evil.invalid" }),
        );
      },
    );
    await t.test(
      "конкурентное приглашение с одним использованием",
      async () => {
        const invite = await owner.call(`/communities/${cid}/invites`, "POST", {
          hours: 1,
          maxUses: 1,
        });
        const token = invite.url.split("/").at(-1);
        const responses = await Promise.all([
          member.raw("/invites/join", "POST", { token }),
          third.raw("/invites/join", "POST", { token }),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 410]);
        if (responses[1].ok) {
          const old = {
            jar: member.jar,
            csrf: member.csrf,
            userId: member.userId,
          };
          Object.assign(member, {
            jar: third.jar,
            csrf: third.csrf,
            userId: third.userId,
          });
          Object.assign(third, old);
        }
        assert.equal(
          (await member.call("/invites/join", "POST", { token })).alreadyMember,
          true,
        );
        assert.equal(
          (await owner.call(`/communities/${cid}/invites`))[0].uses,
          1,
        );
        const another = await owner.call(
          `/communities/${cid}/invites`,
          "POST",
          { hours: 1, maxUses: 10 },
        );
        await owner.call(`/communities/${cid}/invites/${another.id}`, "DELETE");
        assert.equal(
          (
            await fourth.raw("/invites/join", "POST", {
              token: another.url.split("/").at(-1),
            })
          ).status,
          410,
        );
      },
    );
    const ms = await member.socket();
    const outsider = await third.socket();
    const os = await owner.socket();
    t.after(() => {
      ms.close();
      outsider.close();
      os.close();
    });
    let received = 0;
    let leaked = 0;
    ms.on("refresh", () => received++);
    outsider.on("refresh", () => leaked++);
    await t.test("подписка проверяет принадлежность", async () => {
      const good = await ms
        .timeout(3000)
        .emitWithAck("subscribe", { communityId: cid, channelId: chid });
      assert.equal(good.ok, true);
      const bad = await outsider
        .timeout(3000)
        .emitWithAck("subscribe", { communityId: cid, channelId: chid });
      assert.equal(bad.ok, false);
    });
    await t.test(
      "дедупликация, намеренные повторы текста, edit/delete без утечки",
      async () => {
        const clientId = randomUUID();
        const payload = { clientId, content: "<img src=x onerror=alert(1)>" };
        const results = await Promise.all([
          owner.call(path, "POST", payload),
          owner.call(path, "POST", payload),
        ]);
        assert.equal(results[0].id, results[1].id);
        const second = await owner.call(path, "POST", {
          ...payload,
          clientId: randomUUID(),
        });
        assert.notEqual(second.id, results[0].id);
        assert.equal((await member.call(path)).items.length, 2);
        await owner.call(`${path}/${results[0].id}`, "PATCH", {
          content: "Изменено",
        });
        assert.equal((await member.call(path)).items[0].content, "Изменено");
        assert.equal(
          (await member.raw(`${path}/${second.id}`, "DELETE")).status,
          403,
        );
        await owner.call(`${path}/${results[0].id}`, "DELETE");
        const deleted = (await member.call(path)).items[0];
        assert.equal(deleted.content, "");
        assert.ok(deleted.deletedAt);
        const retry = await owner.call(path, "POST", payload);
        assert.equal(retry.content, "");
        assert.ok(retry.deletedAt);
        await delay(100);
        assert.ok(received > 0);
        assert.equal(leaked, 0);
      },
    );
    await t.test(
      "запрет повышения, матрица ADMIN и атомарная передача владельца",
      async () => {
        assert.equal(
          (
            await member.raw(
              `/communities/${cid}/members/${member.userId}`,
              "PATCH",
              { role: "ADMIN" },
            )
          ).status,
          403,
        );
        assert.equal(
          (await owner.raw(`/communities/${cid}/leave`, "POST")).status,
          403,
        );
        await owner.call(
          `/communities/${cid}/members/${member.userId}`,
          "PATCH",
          { role: "ADMIN" },
        );
        assert.equal(
          (
            await member.raw(
              `/communities/${cid}/members/${owner.userId}`,
              "DELETE",
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await member.raw(`/communities/${cid}/transfer`, "POST", {
              userId: member.userId,
            })
          ).status,
          403,
        );
        assert.equal(
          (await member.raw(`/communities/${cid}`, "DELETE")).status,
          403,
        );
        await owner.call(`/communities/${cid}/transfer`, "POST", {
          userId: member.userId,
        });
        let rows = (
          await pool.query(
            'SELECT role FROM "Membership" WHERE "communityId"=$1',
            [cid],
          )
        ).rows;
        assert.equal(rows.filter((r) => r.role === "OWNER").length, 1);
        await member.call(`/communities/${cid}/transfer`, "POST", {
          userId: owner.userId,
        });
        rows = (
          await pool.query(
            'SELECT role FROM "Membership" WHERE "communityId"=$1',
            [cid],
          )
        ).rows;
        assert.equal(rows.filter((r) => r.role === "OWNER").length, 1);
        await owner.call(
          `/communities/${cid}/members/${member.userId}`,
          "PATCH",
          { role: "MEMBER" },
        );
      },
    );
    await t.test(
      "reconnect повторно проверяет доступ; исключение отзывается у открытого клиента",
      async () => {
        ms.disconnect();
        const back = await member.socket();
        t.after(() => back.close());
        assert.equal(
          (
            await back
              .timeout(3000)
              .emitWithAck("subscribe", { communityId: cid })
          ).ok,
          true,
        );
        await owner.call(
          `/communities/${cid}/members/${member.userId}`,
          "DELETE",
        );
        assert.equal((await member.raw(path)).status, 403);
        assert.equal(
          (
            await back
              .timeout(3000)
              .emitWithAck("subscribe", { communityId: cid })
          ).ok,
          false,
        );
        let refreshes = 0;
        back.on("refresh", () => refreshes++);
        await owner.call(path, "POST", {
          clientId: randomUUID(),
          content: "После исключения",
        });
        await delay(100);
        assert.equal(refreshes, 0);
      },
    );
    await t.test("пагинация ограничена и не имеет дублей", async () => {
      for (let i = 0; i < 52; i++)
        await owner.call(path, "POST", {
          clientId: randomUUID(),
          content: `Страница ${i}`,
        });
      const first = await owner.call(path);
      assert.equal(first.items.length, 50);
      assert.ok(first.next);
      const second = await owner.call(`${path}?before=${first.next}`);
      assert.ok(second.items.length > 0);
      assert.equal(
        new Set([...first.items, ...second.items].map((m) => m.id)).size,
        first.items.length + second.items.length,
      );
      assert.equal((await owner.raw(`${path}?limit=99999`)).status, 400);
      assert.equal(
        (await owner.raw(`${path}?before=9999999999999999999`)).status,
        400,
      );
    });
    await t.test(
      "истечение приглашения и сессии открытого socket",
      async () => {
        const invite = await owner.call(`/communities/${cid}/invites`, "POST", {
          hours: 1,
          maxUses: 5,
        });
        await pool.query(
          'UPDATE "Invite" SET "expiresAt" = now() - make_interval(secs => 1) WHERE id=$1',
          [invite.id],
        );
        assert.equal(
          (
            await fourth.raw("/invites/join", "POST", {
              token: invite.url.split("/").at(-1),
            })
          ).status,
          410,
        );
        const socket = await fourth.socket();
        const disconnected = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.close();
            reject(new Error("Сессия не отозвана"));
          }, 20000);
          socket.once("disconnect", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        await pool.query(
          'UPDATE "Session" SET "expiresAt" = now() - make_interval(secs => 1) WHERE "userId"=$1',
          [fourth.userId],
        );
        assert.equal((await fourth.raw("/auth/me")).status, 401);
        await disconnected;
      },
    );
    await t.test("rate limit отправки и удаление канала", async () => {
      let limited = false;
      for (let i = 0; i < 125; i++) {
        const response = await member.raw(path, "POST", {
          clientId: randomUUID(),
          content: "Проверка лимита",
        });
        if (response.status === 429) {
          limited = true;
          break;
        }
        assert.equal(response.status, 403);
      }
      assert.ok(limited);
      const channel = await owner.call(`/communities/${cid}/channels`, "POST", {
        name: "временный",
      });
      await owner.call(`/communities/${cid}/channels/${channel.id}`, "DELETE");
      assert.equal(
        (await owner.raw(`/channels/${channel.id}/messages`)).status,
        404,
      );
    });
    await t.test("выход отзывает cookie и отключает socket", async () => {
      const cookie = owner.cookie;
      const disconnected = new Promise<void>((resolve) =>
        os.once("disconnect", () => resolve()),
      );
      await owner.call("/auth/logout", "POST");
      await disconnected;
      assert.equal(
        (await owner.raw("/auth/me", "GET", undefined, { Cookie: cookie }))
          .status,
        401,
      );
    });
    await t.test(
      "повторный вход, нормализация, ротация сессии и профиль",
      async () => {
        assert.equal(
          (
            await owner.raw("/auth/login", "POST", {
              username: owner.username,
              password: "wrong_password_123456",
            })
          ).status,
          401,
        );
        const user = await owner.call("/auth/login", "POST", {
          username: owner.username.toUpperCase(),
          password: "test_password_123456",
        });
        assert.equal(user.id, owner.userId);
        assert.equal("passwordHash" in user, false);
        const oldCookie = owner.cookie;
        await owner.call("/auth/login", "POST", {
          username: owner.username,
          password: "test_password_123456",
        });
        assert.notEqual(owner.cookie, oldCookie);
        assert.equal(
          (await owner.raw("/auth/me", "GET", undefined, { Cookie: oldCookie }))
            .status,
          401,
        );
        const profile = await owner.call("/auth/profile", "PATCH", {
          displayName: "Новое имя",
        });
        assert.equal(profile.displayName, "Новое имя");
        assert.equal(
          (
            await owner.raw("/auth/profile", "PATCH", {
              displayName: "Нет",
              userId: third.userId,
            })
          ).status,
          400,
        );
        const duplicate = await third.raw("/auth/register", "POST", {
          username: owner.username.toUpperCase(),
          displayName: "Нет",
          password: "test_password_123456",
        });
        assert.equal(duplicate.status, 409);
      },
    );
  },
);

test("CO_OWNER: серверная матрица и запрет повышения привилегий", async () => {
  const owner = await new Client().register();
  const co = await new Client().register();
  const other = await new Client().register();
  const admin = await new Client().register();
  const community = await owner.call("/communities", "POST", {
    name: "Совладельцы",
  });
  const root = `/communities/${community.id}`;
  const invitation = await owner.call(`${root}/invites`, "POST", {
    hours: 1,
    maxUses: 10,
  });
  for (const user of [co, other, admin])
    await user.call("/invites/join", "POST", {
      token: invitation.url.split("/").at(-1),
    });
  assert.equal(
    (
      await co.raw(`${root}/members/${other.userId}`, "PATCH", {
        role: "CO_OWNER",
      })
    ).status,
    403,
  );
  await owner.call(`${root}/members/${co.userId}`, "PATCH", {
    role: "CO_OWNER",
  });
  await owner.call(`${root}/members/${other.userId}`, "PATCH", {
    role: "CO_OWNER",
  });
  await co.call(`${root}/members/${admin.userId}`, "PATCH", { role: "ADMIN" });
  assert.equal(
    (
      await admin.raw(`${root}/members/${co.userId}`, "PATCH", {
        role: "CO_OWNER",
      })
    ).status,
    403,
  );
  for (const target of [owner, other, co]) {
    assert.equal(
      (
        await co.raw(`${root}/members/${target.userId}`, "PATCH", {
          role: "MEMBER",
        })
      ).status,
      403,
    );
    assert.equal(
      (await co.raw(`${root}/members/${target.userId}`, "DELETE")).status,
      403,
    );
  }
  assert.equal(
    (
      await co.raw(`${root}/members/${admin.userId}`, "PATCH", {
        role: "CO_OWNER",
      })
    ).status,
    403,
  );
  assert.equal(
    (await co.raw(`${root}/members/${co.userId}`, "PATCH", { role: "OWNER" }))
      .status,
    400,
  );
  assert.equal(
    (await co.raw(`${root}/transfer`, "POST", { userId: co.userId })).status,
    403,
  );
  assert.equal((await co.raw(root, "DELETE")).status, 403);
  await co.call(root, "PATCH", { name: "Управление совладельца" });
  for (const type of ["TEXT", "VOICE"]) {
    const channel = await co.call(`${root}/channels`, "POST", {
      name: "Канал",
      type,
    });
    await co.call(`${root}/channels/${channel.id}`, "PATCH", {
      name: "Новое имя",
    });
    await co.call(`${root}/channels/${channel.id}`, "DELETE");
  }
  await co.call(`${root}/members/${admin.userId}`, "PATCH", { role: "MEMBER" });
  await co.call(`${root}/members/${admin.userId}`, "PATCH", { role: "ADMIN" });
  await co.call(`${root}/members/${admin.userId}`, "DELETE");
  await owner.call(`${root}/members/${other.userId}`, "PATCH", {
    role: "MEMBER",
  });
  const detail = await owner.call(root);
  assert.equal(
    detail.members.filter((m: { role: string }) => m.role === "OWNER").length,
    1,
  );
});
