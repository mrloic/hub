import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaults,
  migrateAudio,
  profileSettings,
  constraintsFor,
  participantVolume,
  effectiveVolume,
  availableDevice,
} from "../../packages/audio/src/settings";
import {
  AudioPipeline,
  NoneNoiseProcessor,
  RNNoiseProcessor,
  VoiceGate,
} from "../../packages/audio/src/dsp";
import {
  parseShortcut,
  HeldShortcut,
} from "../../packages/audio/src/shortcuts";
import { SettingsStore, closeAction } from "../../apps/desktop/src/settings";
import { Shortcuts } from "../../apps/desktop/src/shortcuts";
import {
  desktopDefaults,
  type DesktopEvent,
} from "../../packages/shared/src/desktop";
import {
  trusted,
  networkAllowed,
  localAsset,
  externalLink,
} from "../../apps/desktop/src/security";
test("настройки: миграция старого WebRTC, диапазоны и локальное сохранение", () => {
  assert.equal(
    migrateAudio({ noiseSuppression: false }).noiseSuppressionMode,
    "off",
  );
  assert.equal(migrateAudio({ version: 99, autostart: true }).version, 2);
  assert.equal(
    migrateAudio({ microphoneGain: 9, manualSensitivity: -100 }).microphoneGain,
    1,
  );
  assert.equal(migrateAudio({ microphoneGain: NaN }).microphoneGain, 1);
  const dir = mkdtempSync(join(tmpdir(), "hub-settings-"));
  try {
    const store = new SettingsStore(join(dir, "settings.json"));
    assert.equal(store.read().autostart, false);
    store.save({ ...desktopDefaults, minimizeToTray: false });
    assert.equal(
      new SettingsStore(join(dir, "settings.json")).read().minimizeToTray,
      false,
    );
    assert.ok(
      !readFileSync(join(dir, "settings.json"), "utf8").includes("password"),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("нет двойного DSP, profiles, устройства и participant reconnect", () => {
  const enhanced = profileSettings("isolation", defaults);
  assert.deepEqual(
    constraintsFor(enhanced, {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      voiceIsolation: true,
    }),
    {
      deviceId: "default",
      channelCount: 1,
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
      voiceIsolation: false,
    },
  );
  assert.equal(profileSettings("studio", defaults).autoGainControl, false);
  assert.equal(availableDevice("gone", []), "default");
  assert.equal(availableDevice("mic", [{ deviceId: "mic" }]), "mic");
  const settings = migrateAudio({ participantVolumes: { stable: 0.3 } });
  assert.equal(
    participantVolume(
      migrateAudio(JSON.parse(JSON.stringify(settings))),
      "stable",
    ),
    0.3,
  );
  assert.equal(participantVolume(settings, "other"), 1);
  assert.equal(effectiveVolume(0.3, true), 0);
  assert.equal(effectiveVolume(0.3, false), 0.3);
});
test("VAD: attack, hysteresis, hangover и manual sensitivity", () => {
  const gate = new VoiceGate(),
    settings = {
      ...defaults,
      automaticSensitivity: false,
      manualSensitivity: -40,
    };
  assert.equal(gate.update(-30, settings).active, false);
  gate.update(-30, settings);
  assert.equal(gate.update(-30, settings).active, true);
  for (let i = 0; i < 50; i++)
    assert.equal(gate.update(-43, settings).active, true);
  for (let i = 0; i < 24; i++)
    assert.equal(gate.update(-65, settings).active, true);
  assert.equal(gate.update(-65, settings).active, false);
});
test("gain/PTT: закрытый затвор, удержание и ограниченная задержка отпускания", () => {
  const pipeline = new AudioPipeline(
    {
      ...defaults,
      inputMode: "ptt",
      microphoneGain: 0.5,
      pushToTalkReleaseDelay: 100,
    },
    new NoneNoiseProcessor(),
  );
  const frame = () => new Float32Array(480).fill(0.5);
  let block = frame();
  pipeline.process(block);
  assert.equal(block[479], 0);
  pipeline.ptt = true;
  for (let i = 0; i < 4; i++) {
    block = frame();
    pipeline.process(block);
  }
  assert.ok(Math.abs(block[479] - 0.25) < 0.001);
  pipeline.ptt = false;
  for (let i = 0; i < 9; i++)
    assert.equal(pipeline.process(frame()).active, true);
  assert.equal(pipeline.process(frame()).active, false);
  for (let i = 0; i < 5; i++) {
    block = frame();
    pipeline.process(block);
  }
  assert.ok(block[479] < 0.0001);
});
test("RNNoise: настоящая WASM, synthetic fan/keyboard/harmonics, bounded finite PCM", async () => {
  const { Rnnoise } =
    await import("../../apps/web/src/voice/audio/rnnoise.generated.js");
  const module = await Rnnoise.load();
  assert.equal(module.frameSize, 480);
  const engine = new RNNoiseProcessor(module.createDenoiseState());
  const pipeline = new AudioPipeline(
    {
      ...defaults,
      noiseSuppressionMode: "rnnoise",
      automaticSensitivity: false,
      manualSensitivity: -50,
    },
    engine,
  );
  let seed = 7,
    totalEnergy = 0;
  const start = performance.now();
  for (let block = 0; block < 300; block++) {
    const frame = new Float32Array(480);
    for (let i = 0; i < 480; i++) {
      const time = (block * 480 + i) / 48000;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff - 0.5) * 0.025;
      const voice =
        block < 100
          ? 0
          : 0.15 * Math.sin(2 * Math.PI * 180 * time) +
            0.08 * Math.sin(2 * Math.PI * 360 * time);
      frame[i] = noise + voice + (block % 37 === 0 && i < 20 ? 0.05 : 0);
    }
    const meter = pipeline.process(frame);
    if (block > 110)
      assert.equal(
        meter.active,
        true,
        "VAD не обрывает активный синтетический сигнал",
      );
    for (const sample of frame) {
      assert.ok(Number.isFinite(sample));
      assert.ok(Math.abs(sample) < 1.1);
      totalEnergy += sample * sample;
    }
  }
  pipeline.destroy();
  assert.ok(totalEnergy > 0.001);
  assert.ok(
    performance.now() - start < 10000,
    "3 секунды fixture должны обрабатываться за ограниченное время, не заявляя realtime throughput",
  );
});
test("global shortcuts: conflict, key release, teardown, tray", async () => {
  const registered = new Map<string, () => void>();
  const events: DesktopEvent[] = [];
  let down = true;
  const shortcuts = new Shortcuts(
    {
      register: (key, handler) => {
        if (key === "F12") return false;
        registered.set(key, handler);
        return true;
      },
      unregister: (key) => {
        registered.delete(key);
      },
    },
    (event) => events.push(event),
    () => down,
  );
  shortcuts.configure({
    ...desktopDefaults,
    pushToTalkShortcut: "Ctrl+Alt+K",
    muteShortcut: "F8",
  });
  shortcuts.voiceActive(true);
  registered.get("Ctrl+Alt+K")!();
  assert.deepEqual(events.at(-1), { type: "ptt", down: true });
  down = false;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(events.at(-1), { type: "ptt", down: false });
  down = true;
  registered.get("Ctrl+Alt+K")!();
  shortcuts.voiceActive(false);
  assert.deepEqual(events.at(-1), { type: "ptt", down: false });
  shortcuts.clear();
  assert.equal(registered.size, 0);
  assert.throws(() =>
    shortcuts.configure({ ...desktopDefaults, muteShortcut: "F12" }),
  );
  assert.equal(registered.size, 0);
  const state = new HeldShortcut();
  state.update(true, () => {});
  state.update(false, () => {});
  assert.equal(state.down, false);
  assert.equal(parseShortcut("Ctrl+Alt+K")?.keys.at(-1), 75);
  assert.equal(parseShortcut("Ctrl+Meta+K"), null);
  assert.equal(closeAction(false, true), "hide");
  assert.equal(closeAction(true, true), "quit");
  assert.equal(closeAction(false, false), "quit");
});
test("desktop origin/navigation/path checks", () => {
  assert.equal(trusted("https://hub.mrloic.ru/c/test"), true);
  assert.equal(trusted("https://hub.mrloic.ru.evil/"), false);
  assert.equal(networkAllowed("https://rtc.mrloic.ru/livekit/rtc"), true);
  assert.equal(networkAllowed("http://hub.mrloic.ru"), false);
  assert.equal(networkAllowed("https://user:pass@hub.mrloic.ru"), false);
  assert.equal(localAsset("/app/web", "/%2e%2e/secret"), null);
  assert.equal(externalLink("javascript:alert(1)"), false);
});
