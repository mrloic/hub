import { VoiceSettings } from "./VoiceSettings";
import { participantVolume } from "../../../../packages/audio/src/settings";
import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import type { Channel } from "../../../../packages/shared/src";
import type { VoiceState } from "./useVoice";
export function VoicePanel({
  voice,
  selected,
}: {
  voice: VoiceState;
  selected?: Channel;
}) {
  const [settings, setSettings] = useState(false);
  const [volumeFor, setVolumeFor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    const open = () => setSettings(true);
    window.addEventListener("voice-settings", open);
    return () => window.removeEventListener("voice-settings", open);
  }, []);
  const target = selected?.type === "VOICE" ? selected : undefined;
  if (!target && !voice.active && !voice.error && !voice.busy && !settings)
    return null;
  return (
    <section className="voice-panel" aria-label="Голосовое общение">
      <div className="voice-heading">
        <div>
          <strong>
            ◉ {voice.active?.channelName ?? target?.name ?? "Голос"}
          </strong>
          <p className="muted" data-testid="voice-state" role="status">
            {voice.state}
          </p>
        </div>
        {target && target.id !== voice.active?.channelId && (
          <button
            className="primary"
            disabled={!voice.enabled || voice.busy}
            onClick={() => void voice.connect(target)}
          >
            {voice.active
              ? "Перейти в этот голосовой канал"
              : "Подключиться к голосу"}
          </button>
        )}
        {(voice.active || voice.busy) && (
          <button className="danger" onClick={() => void voice.leave()}>
            Выйти из голоса
          </button>
        )}
      </div>
      {!voice.enabled && (
        <p className="muted">Голос выключен в настройках сервиса.</p>
      )}
      {voice.active && (
        <>
          <div className="voice-controls">
            <button onClick={() => setSettings(true)}>Настройки голоса</button>
            <button
              aria-pressed={voice.sharing}
              disabled={voice.screenBusy || voice.state !== "Голос подключён"}
              onClick={() => void voice.toggleScreen()}
            >
              {voice.sharing
                ? "Остановить демонстрацию"
                : "Демонстрация экрана"}
            </button>
            <button
              disabled={voice.busy}
              aria-pressed={voice.mic}
              onClick={() => void voice.toggleMicrophone()}
            >
              {voice.mic ? "Выключить микрофон" : "Включить микрофон"}
            </button>
            <button aria-pressed={voice.deaf} onClick={voice.togglePlayback}>
              {voice.deaf
                ? "Включить воспроизведение"
                : "Отключить воспроизведение"}
            </button>
            {voice.playbackBlocked && !voice.deaf && (
              <button onClick={() => void voice.startAudio()}>
                Разрешить воспроизведение
              </button>
            )}
          </div>
          <ul className="voice-people" aria-label="Участники голосового канала">
            {voice.people.map((p) => (
              <li
                key={p.id}
                data-testid="voice-participant"
                data-speaking={p.speaking}
                className={p.speaking ? "speaking" : ""}
              >
                <span className="avatar">{p.name.slice(0, 1)}</span>
                <span className="voice-person-name" title={p.name}>
                  {p.name}
                  {p.local ? " (вы)" : ""}
                </span>
                <span
                  className="mic-status"
                  role="img"
                  aria-label={
                    p.microphone ? "Микрофон включён" : "Микрофон выключен"
                  }
                  data-muted={!p.microphone}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8" />
                    {!p.microphone && <path d="M2 2l20 20" />}
                  </svg>
                </span>
                <span className="screen-status">
                  {!p.local && (
                    <button
                      aria-label={`Громкость: ${p.name}`}
                      onClick={() => setVolumeFor({ id: p.id, name: p.name })}
                    >
                      ♫
                    </button>
                  )}
                </span>
                <span className="screen-status">
                  {p.screen && (
                    <button
                      aria-label={`Смотреть экран: ${p.name}`}
                      title="Демонстрирует экран"
                      onClick={() => voice.selectScreen(p.id)}
                    >
                      ▣
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {voice.active && (
        <p className="muted">
          Передача системного звука зависит от браузера и выбранного источника.
        </p>
      )}
      {settings && (
        <VoiceSettings voice={voice} close={() => setSettings(false)} />
      )}
      {volumeFor && (
        <Modal
          title={`Громкость пользователя: ${volumeFor.name}`}
          close={() => setVolumeFor(null)}
        >
          <label>
            Громкость пользователя ·{" "}
            {Math.round(
              participantVolume(voice.processing, volumeFor.id) * 100,
            )}
            %
            <input
              type="range"
              min="0"
              max="100"
              value={participantVolume(voice.processing, volumeFor.id) * 100}
              onChange={(e) =>
                voice.setParticipantVolume(
                  volumeFor.id,
                  Number(e.target.value) / 100,
                )
              }
            />
          </label>
          <button onClick={() => voice.setParticipantVolume(volumeFor.id, 1)}>
            Сбросить громкость
          </button>
          <p>Изменяется только ваше воспроизведение.</p>
        </Modal>
      )}
      {voice.error && (
        <p className="error" role="alert">
          {voice.error}
        </p>
      )}
    </section>
  );
}
