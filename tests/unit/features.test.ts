import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAssignRole,
  canKick,
  canManage,
  canDeleteMessage,
  type Role,
} from "../../packages/shared/src";
import {
  captureConstraints,
  defaultProcessing,
} from "../../apps/web/src/voice/processing";
test("CO_OWNER: критические операции исключены из матрицы", () => {
  const roles: Role[] = ["OWNER", "CO_OWNER", "ADMIN", "MEMBER"];
  assert.equal(canManage("CO_OWNER"), true);
  for (const target of roles)
    for (const next of roles) {
      assert.equal(
        canAssignRole("CO_OWNER", target, next),
        ["ADMIN", "MEMBER"].includes(target) &&
          ["ADMIN", "MEMBER"].includes(next),
      );
      assert.equal(canAssignRole("ADMIN", target, next), false);
      assert.equal(canAssignRole("MEMBER", target, next), false);
    }
  assert.equal(canAssignRole("OWNER", "MEMBER", "CO_OWNER"), true);
  assert.equal(canKick("CO_OWNER", "OWNER"), false);
  assert.equal(canKick("CO_OWNER", "CO_OWNER"), false);
  assert.equal(canKick("CO_OWNER", "ADMIN"), true);
  assert.equal(canDeleteMessage("CO_OWNER", "ADMIN", false), true);
});
test("обработка микрофона: optional constraints и voiceIsolation detection", () => {
  assert.deepEqual(captureConstraints(defaultProcessing, {}), {});
  assert.deepEqual(
    captureConstraints(defaultProcessing, {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    }),
    defaultProcessing,
  );
  assert.deepEqual(
    captureConstraints(defaultProcessing, { voiceIsolation: true }),
    { voiceIsolation: true },
  );
  assert.deepEqual(
    captureConstraints(
      { ...defaultProcessing, noiseSuppression: false },
      { voiceIsolation: true },
    ),
    { voiceIsolation: false },
  );
});
