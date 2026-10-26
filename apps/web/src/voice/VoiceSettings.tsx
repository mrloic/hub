import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import {
  profileSettings,
  type AudioSettings,
} from "../../../../packages/audio/src/settings";
import type { VoiceState } from "./useVoice";
import type { DesktopSettings } from "../../../../packages/shared/src/desktop";
export function VoiceSettings({
  voice,
  close,
}: {
  voice: VoiceState;
  close: () => void;
}) {
  const [desktop, setDesktop] = useState<DesktopSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.hubDesktop?.getSettings().then((value) => {
      setDesktop(value);
      setError(value.error ?? "");
      if (voice.processing.pushToTalkShortcut !== value.pushToTalkShortcut)
        void voice.updateProcessing({
          ...voice.processing,
          pushToTalkShortcut: value.pushToTalkShortcut,
        });
    });
    void voice.refreshDevices();
    return () => {
      void voice.stopTest();
    };
  }, []);
  const settings = voice.processing;
  const update = (patch: Partial<AudioSettings>) =>
    void voice.updateProcessing({ ...settings, ...patch, profile: "custom" });
  async function saveDesktop(next: DesktopSettings) {
    const result = await window.hubDesktop!.saveSettings(next);
    setDesktop(result.settings);
    setError(result.error ?? "");
    if (!result.error)
      update({ pushToTalkShortcut: result.settings.pushToTalkShortcut });
  }
  const supported = navigator.mediaDevices?.getSupportedConstraints() ?? {};
  return (
    <Modal title="Настройки голоса" close={close}>
      <label>
        Профиль
        <select
          aria-label="Профиль"
          value={settings.profile}
          disabled={voice.processingBusy}
          onChange={(e) =>
            void voice.updateProcessing(
              profileSettings(
                e.target.value as AudioSettings["profile"],
                settings,
              ),
            )
          }
        >
          <option value="isolation">Изоляция голоса</option>
          <option value="studio">Студия</option>
          <option value="custom">Пользовательский</option>
        </select>
      </label>
      <label>
        Устройство ввода
        <select
          aria-label="Устройство ввода"
          value={settings.inputDeviceId}
          disabled={voice.processingBusy}
          onChange={(e) => update({ inputDeviceId: e.target.value })}
        >
          <option value="default">Default — по умолчанию</option>
          {voice.devices
            .filter(
              (d) =>
                d.kind === "audioinput" &&
                d.deviceId &&
                d.deviceId !== "default",
            )
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Микрофон ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      {"setSinkId" in HTMLMediaElement.prototype ? (
        <label>
          Устройство вывода
          <select
            aria-label="Устройство вывода"
            value={settings.outputDeviceId}
            onChange={(e) => update({ outputDeviceId: e.target.value })}
          >
            <option value="default">Default — по умолчанию</option>
            {voice.devices
              .filter(
                (d) =>
                  d.kind === "audiooutput" &&
                  d.deviceId &&
                  d.deviceId !== "default",
              )
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Устройство ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <p>Этот браузер использует системное устройство вывода.</p>
      )}
      <p className="muted">
        Для отображения названий устройств запустите проверку микрофона и
        разрешите доступ.
      </p>
      <label>
        Громкость микрофона · {Math.round(settings.microphoneGain * 100)}%
        <input
          type="range"
          min="0"
          max="100"
          value={settings.microphoneGain * 100}
          onChange={(e) =>
            update({ microphoneGain: Number(e.target.value) / 100 })
          }
        />
      </label>
      <h3>Обработка микрофона</h3>
      <label>
        Шумоподавление
        <select
          aria-label="Шумоподавление"
          value={settings.noiseSuppressionMode}
          disabled={voice.processingBusy}
          onChange={(e) =>
            update({
              noiseSuppressionMode: e.target
                .value as AudioSettings["noiseSuppressionMode"],
            })
          }
        >
          <option value="off">Выключено</option>
          <option value="standard">Стандартное</option>
          <option value="rnnoise">Улучшенное шумоподавление</option>
        </select>
      </label>
      <p className="muted">
        RNNoise — локальная обработка на вашем компьютере. Обработка выполняется
        локально на вашем компьютере.
      </p>
      {(["echoCancellation", "autoGainControl"] as const)
        .filter((key) => supported[key])
        .map((key) => (
          <label className="processing-option" key={key}>
            <input
              type="checkbox"
              disabled={voice.processingBusy}
              checked={settings[key]}
              onChange={(e) => update({ [key]: e.target.checked })}
            />
            {key === "echoCancellation"
              ? "Подавление эха"
              : "Автоматическая регулировка усиления"}
          </label>
        ))}
      <label>
        Режим ввода
        <select
          aria-label="Режим ввода"
          value={settings.inputMode}
          onChange={(e) =>
            update({ inputMode: e.target.value as AudioSettings["inputMode"] })
          }
        >
          <option value="vad">Активация по голосу</option>
          <option value="ptt">Push-to-Talk</option>
        </select>
      </label>
      {settings.inputMode === "vad" ? (
        <>
          <label className="processing-option">
            <input
              type="checkbox"
              checked={settings.automaticSensitivity}
              onChange={(e) =>
                update({ automaticSensitivity: e.target.checked })
              }
            />
            Автоматически определять чувствительность
          </label>
          {!settings.automaticSensitivity && (
            <label>
              Порог активации · {settings.manualSensitivity} dB
              <input
                type="range"
                min="-80"
                max="-10"
                value={settings.manualSensitivity}
                onChange={(e) =>
                  update({ manualSensitivity: Number(e.target.value) })
                }
              />
            </label>
          )}
          <p className="muted">
            Открытие: 30 мс. Задержка закрытия: 250 мс. Гистерезис: 6 dB.
          </p>
        </>
      ) : (
        <>
          {!desktop && (
            <label>
              Клавиша Push-to-Talk
              <input
                value={settings.pushToTalkShortcut}
                placeholder="Например, Ctrl+Alt+K"
                onChange={(e) => update({ pushToTalkShortcut: e.target.value })}
              />
            </label>
          )}
          <label>
            Задержка отпускания · {settings.pushToTalkReleaseDelay} мс
            <input
              type="range"
              min="0"
              max="1000"
              step="10"
              value={settings.pushToTalkReleaseDelay}
              onChange={(e) =>
                update({ pushToTalkReleaseDelay: Number(e.target.value) })
              }
            />
          </label>
          <p className="muted">
            {desktop
              ? "Сочетание задаётся ниже. Системные и игровые ограничения Windows могут препятствовать глобальной клавише."
              : "В браузере PTT работает только в активном окне вне полей ввода."}
          </p>
        </>
      )}
      <div
        className="audio-meter"
        role="meter"
        aria-label="Уровень микрофона"
        aria-valuemin={-80}
        aria-valuemax={0}
        aria-valuenow={Math.max(-80, Math.min(0, voice.meter.db))}
      >
        <span
          style={{
            width: `${Math.max(0, Math.min(100, ((voice.meter.db + 80) / 80) * 100))}%`,
          }}
        />
      </div>
      <p>
        {voice.meter.clipping
          ? "Перегрузка микрофона"
          : `${Math.round(voice.meter.db)} dB · порог ${Math.round(voice.meter.threshold)} dB`}{" "}
        · {voice.meter.active ? "Передача разрешена" : "Затвор закрыт"}
      </p>
      <p className="muted">
        DSP:{" "}
        {voice.meter.load === null
          ? "измерение времени недоступно"
          : `${(voice.meter.load * 100).toFixed(1)}% бюджета кадра`}{" "}
        · пропуски буфера: {voice.meter.underflows}
      </p>
      <button
        disabled={voice.busy || voice.mic}
        onClick={() => void voice.startTest()}
      >
        {voice.testing ? "Остановить проверку" : "Проверить микрофон"}
      </button>
      <p className="muted">
        Проверка не публикуется в звонок и не воспроизводится в динамиках. Во
        время звонка сначала выключите микрофон.
      </p>
      {desktop && (
        <section>
          <h3>Приложение Windows</h3>
          {(["minimizeToTray", "autostart", "notifications"] as const).map(
            (key) => (
              <label className="processing-option" key={key}>
                <input
                  type="checkbox"
                  checked={desktop[key]}
                  onChange={(e) =>
                    void saveDesktop({ ...desktop, [key]: e.target.checked })
                  }
                />
                {
                  {
                    minimizeToTray: "Сворачивать в трей",
                    autostart: "Запускать Hub вместе с Windows",
                    notifications: "Уведомления о новых сообщениях",
                  }[key]
                }
              </label>
            ),
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void saveDesktop({
                ...desktop,
                pushToTalkShortcut: String(data.get("ptt")),
                muteShortcut: String(data.get("mute")),
                deafenShortcut: String(data.get("deafen")),
              });
            }}
          >
            <label>
              Push-to-Talk
              <input
                name="ptt"
                defaultValue={desktop.pushToTalkShortcut}
                placeholder="Ctrl+Alt+K"
              />
            </label>
            <label>
              Mute microphone
              <input
                name="mute"
                defaultValue={desktop.muteShortcut}
                placeholder="Не назначено"
              />
            </label>
            <label>
              Deafen
              <input
                name="deafen"
                defaultValue={desktop.deafenShortcut}
                placeholder="Не назначено"
              />
            </label>
            <button>Сохранить горячие клавиши</button>
          </form>
          <p className="muted">
            Пустое значение удаляет назначение. Допустимы Ctrl/Alt/Shift, буквы,
            цифры, Space и F1–F24.
          </p>
        </section>
      )}
      {voice.error && <p role="alert">{voice.error}</p>}
      {voice.processingNotice && <p role="status">{voice.processingNotice}</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
