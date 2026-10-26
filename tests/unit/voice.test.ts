import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelInput,
  voiceJoinInput,
  voiceLeaveInput,
} from "../../packages/shared/src";
test("TEXT по умолчанию; VOICE явный; права/комната/identity не принимаются", () => {
  assert.equal(channelInput.parse({ name: "общий" }).type, "TEXT");
  assert.equal(
    channelInput.parse({ name: "Голос", type: "VOICE" }).type,
    "VOICE",
  );
  assert.equal(
    channelInput.safeParse({ name: "Камера", type: "VIDEO" }).success,
    false,
  );
  assert.equal(
    voiceJoinInput.safeParse({ channelId: crypto.randomUUID(), room: "evil" })
      .success,
    false,
  );
  assert.equal(
    voiceJoinInput.safeParse({ channelId: crypto.randomUUID(), role: "OWNER" })
      .success,
    false,
  );
  assert.equal(
    voiceLeaveInput.safeParse({ leaseId: "anything" }).success,
    false,
  );
});

import { microphoneError } from "../../apps/web/src/voice/microphoneError";
test("ошибки микрофона понятны и не выводят технический текст", () => {
  assert.match(
    microphoneError(new DOMException("private detail", "NotAllowedError")),
    /запрещён/,
  );
  assert.match(
    microphoneError(new DOMException("private detail", "NotFoundError")),
    /не найден/,
  );
  assert.match(
    microphoneError(new DOMException("private detail", "NotReadableError")),
    /занят/,
  );
  assert.match(
    microphoneError(new DOMException("private detail", "NotSupportedError")),
    /не поддерживает/,
  );
  assert.ok(
    !microphoneError(new Error("private detail")).includes("private detail"),
  );
});
