import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TokenVerifier, RoomServiceClient } from "livekit-server-sdk";
const production = process.env.TEST_PRODUCTION_GATEWAY === "true";
const base = production
  ? "http://production-api:3000"
  : process.env.TEST_BASE_URL!;
const origin = production ? "https://hub.mrloic.ru" : base;
if (
  process.env.APP_ENV !== "test" ||
  !process.env.DATABASE_URL?.endsWith("/hub_test")
)
  throw new Error("Только изолированная тестовая БД");
class Client {
  csrf = "";
  cookie = "";
  id = "";
  async call(path: string, method = "GET", body?: unknown) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Cookie: this.cookie,
        Origin: origin,
        "X-Hub-CSRF": this.csrf,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const value of res.headers.getSetCookie()) {
      if (production) {
        assert.match(value, /; Secure/i);
        assert.match(value, /; HttpOnly/i);
        assert.match(value, /; SameSite=Strict/i);
        assert.doesNotMatch(value, /; Domain=/i);
      }
      const pair = value.split(";")[0];
      const key = pair.split("=")[0];
      this.cookie = this.cookie
        .split("; ")
        .filter((v) => v && !v.startsWith(`${key}=`))
        .concat(pair)
        .join("; ");
    }
    return res;
  }
  async ok(path: string, method = "GET", body?: unknown) {
    const res = await this.call(path, method, body);
    assert.ok(res.ok, `${path}: ${res.status}`);
    return res.json();
  }
  async register() {
    this.csrf = (await this.ok("/auth/csrf")).csrf;
    this.id = (
      await this.ok("/auth/register", "POST", {
        username: `v_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
        displayName: "Голос",
        password: "voice_test_password_123",
      })
    ).id;
    return this;
  }
  async validate(token: string) {
    return fetch(
      `${base}/livekit/rtc/validate?access_token=${encodeURIComponent(token)}`,
      {
        headers: {
          ...(production ? {} : { Cookie: this.cookie }),
          Origin: origin,
        },
      },
    );
  }
}
test(
  "LiveKit: минимальный token, доступ, подмена room, отзыв и один канал",
  { timeout: 60000 },
  async () => {
    const owner = await new Client().register();
    const member = await new Client().register();
    const outsider = await new Client().register();
    const community = await owner.ok("/communities", "POST", {
      name: "Голосовой тест",
    });
    const cid = community.id;
    const channel = await owner.ok(`/communities/${cid}/channels`, "POST", {
      name: "Голос",
      type: "VOICE",
    });
    const another = await owner.ok(`/communities/${cid}/channels`, "POST", {
      name: "Другой голос",
      type: "VOICE",
    });
    const detail = await owner.ok(`/communities/${cid}`);
    const text = detail.channels.find(
      (c: { type: string }) => c.type === "TEXT",
    );
    assert.equal(
      (await outsider.call("/voice/join", "POST", { channelId: channel.id }))
        .status,
      403,
    );
    assert.equal(
      (await owner.call("/voice/join", "POST", { channelId: text.id })).status,
      404,
    );
    assert.equal(
      (await owner.call("/voice/join", "POST", { channelId: randomUUID() }))
        .status,
      404,
    );
    assert.equal(
      (
        await owner.call("/voice/join", "POST", {
          channelId: channel.id,
          room: "other",
          userId: outsider.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (await owner.call(`/channels/${channel.id}/messages`)).status,
      403,
    );
    const invite = await owner.ok(`/communities/${cid}/invites`, "POST", {
      hours: 1,
      maxUses: 5,
    });
    await member.ok("/invites/join", "POST", {
      token: invite.url.split("/").at(-1),
    });
    assert.equal(
      (
        await member.call(`/communities/${cid}/channels`, "POST", {
          name: "Нет",
          type: "VOICE",
        })
      ).status,
      403,
    );
    const ticket = await member.ok("/voice/join", "POST", {
      channelId: channel.id,
    });
    const verifier = new TokenVerifier(
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    const claims = await verifier.verify(ticket.token);
    assert.equal(claims.sub, member.id);
    assert.equal(claims.metadata, ticket.leaseId);
    assert.equal(claims.video?.room, `hub_voice_${channel.id}`);
    assert.equal(claims.video?.roomJoin, true);
    assert.deepEqual(claims.video?.canPublishSources, [
      "microphone",
      "screen_share",
      "screen_share_audio",
    ]);
    assert.equal(claims.video?.canPublishData, false);
    assert.equal(claims.video?.canUpdateOwnMetadata, false);
    assert.ok(
      !claims.video?.roomAdmin &&
        !claims.video?.roomCreate &&
        !claims.video?.roomList &&
        !claims.video?.roomRecord,
    );
    assert.equal((await member.validate(ticket.token)).status, 200);
    // Production rtc uses a bearer token, never a domain-wide cookie.
    // Its nonce still binds it to a live Hub session and membership.
    if (!production)
      assert.equal((await outsider.validate(ticket.token)).status, 403);
    else assert.equal(ticket.serverUrl, "wss://rtc.mrloic.ru/livekit");
    const tampered = ticket.token.slice(0, -6) + "AAAAAA";
    assert.equal((await member.validate(tampered)).status, 403);
    assert.equal(
      (
        await fetch(
          `${base}/livekit/rtc/v1/validate?access_token=${encodeURIComponent(ticket.token)}`,
          {
            headers: {
              Cookie: member.cookie,
              Origin: "https://untrusted.invalid",
            },
          },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/voice/join`, {
          method: "POST",
          headers: {
            Cookie: member.cookie,
            Origin: origin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channelId: channel.id }),
        })
      ).status,
      403,
    );
    const simultaneous = await Promise.all([
      member.ok("/voice/join", "POST", { channelId: channel.id }),
      member.ok("/voice/join", "POST", { channelId: another.id }),
    ]);
    const validation = await Promise.all(
      simultaneous.map(async (v) => (await member.validate(v.token)).status),
    );
    assert.deepEqual(validation.sort(), [200, 403]);
    const switched = await member.ok("/voice/join", "POST", {
      channelId: another.id,
    });
    assert.equal((await member.validate(ticket.token)).status, 403);
    assert.equal((await member.validate(switched.token)).status, 200);
    await member.ok("/voice/leave", "POST", { leaseId: ticket.leaseId }); // stale tab cannot revoke new lease
    assert.equal((await member.validate(switched.token)).status, 200);
    await owner.ok(`/communities/${cid}/members/${member.id}`, "DELETE");
    assert.equal((await member.validate(switched.token)).status, 403);
    assert.equal(
      (await member.call("/voice/join", "POST", { channelId: another.id }))
        .status,
      403,
    );
    const owned = await owner.ok("/voice/join", "POST", {
      channelId: channel.id,
    });
    await owner.ok(`/communities/${cid}/channels/${channel.id}`, "PATCH", {
      name: "Переименован",
    });
    await owner.ok(`/communities/${cid}/channels/${channel.id}`, "DELETE");
    assert.equal((await owner.validate(owned.token)).status, 403);
    const rooms = new RoomServiceClient(
      process.env.LIVEKIT_URL!,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    assert.equal(
      (await rooms.listRooms([`hub_voice_${channel.id}`])).length,
      0,
    );
    const beforeLogout = await owner.ok("/voice/join", "POST", {
      channelId: another.id,
    });
    await owner.ok("/auth/logout", "POST");
    assert.equal((await owner.validate(beforeLogout.token)).status, 403);
  },
);
