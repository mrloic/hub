import { useEffect, useState } from "react";
import type { DesktopEvent } from "../../../../packages/shared/src/desktop";
import { Modal } from "./Modal";
export function DesktopCapture() {
  const [request, setRequest] = useState<Extract<
    DesktopEvent,
    { type: "capture" }
  > | null>(null);
  const [audio, setAudio] = useState(false);
  useEffect(
    () =>
      window.hubDesktop?.onEvent((event) => {
        if (event.type === "capture-cancel") setRequest(null);
        if (event.type === "capture") {
          setAudio(false);
          setRequest(event);
        }
      }),
    [],
  );
  async function select(id: string | null) {
    await window.hubDesktop?.selectCapture(id, audio);
    setRequest(null);
  }
  if (!request) return null;
  return (
    <Modal title="Выберите экран или окно" close={() => void select(null)}>
      {request.audio && (
        <label className="processing-option">
          <input
            type="checkbox"
            checked={audio}
            onChange={(e) => setAudio(e.target.checked)}
          />
          Передавать системный звук
        </label>
      )}
      <p className="muted">
        В Windows loopback может включать весь системный звук, а не только
        выбранное окно. Не включайте звук самого звонка.
      </p>
      <div className="capture-grid">
        {request.sources.map((source) => (
          <button key={source.id} onClick={() => void select(source.id)}>
            <img src={source.thumbnail} alt="" />
            {source.name}
          </button>
        ))}
      </div>
    </Modal>
  );
}
