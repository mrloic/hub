import { useEffect, useRef, useId, type ReactNode } from "react";
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const backdrop = useRef(false);
  const outside = (event: React.PointerEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby={titleId}
      onPointerDown={(event) => {
        backdrop.current = outside(event);
      }}
      onPointerUp={(event) => {
        if (backdrop.current && outside(event)) close();
        backdrop.current = false;
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button onClick={close} aria-label="Закрыть диалог">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
