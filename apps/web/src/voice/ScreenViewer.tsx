import { useEffect, useRef, useState } from "react";
import type { VideoTrack } from "livekit-client";
export function ScreenViewer({
  name,
  track,
  close,
}: {
  name: string;
  track?: VideoTrack;
  close: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReady(false);
    const element = video.current;
    if (track && element) track.attach(element);
    return () => {
      if (track && element) track.detach(element);
    };
  }, [track]);
  return (
    <section
      className="screen-viewer"
      ref={container}
      aria-label="Просмотр демонстрации"
    >
      <header className="row">
        <strong>{name} · Демонстрация экрана</strong>
        {document.fullscreenEnabled && (
          <button
            onClick={() =>
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : container.current?.requestFullscreen()
              )?.catch(() => setError("Полноэкранный режим недоступен."))
            }
          >
            На весь экран
          </button>
        )}
        <button onClick={close}>Закрыть просмотр</button>
      </header>
      {!ready && (
        <p role="status">
          {track
            ? "Загрузка демонстрации…"
            : "Ожидание трансляции. Возможно, участник остановил демонстрацию."}
        </p>
      )}
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setReady(true)}
        data-testid="screen-video"
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
