import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  canDeleteMessage,
  type Channel,
  type ChatMessage,
  type Member,
  type Role,
  type User,
} from "../../../../packages/shared/src";
import { ApiError, errorText, request } from "../api";
import { Modal } from "./Modal";
type Pending = {
  clientId: string;
  content: string;
  state: "sending" | "error";
};
type Page = { items: ChatMessage[]; next: string | null };
export function Chat({
  channel,
  user,
  role,
  members,
  revision,
}: {
  channel: Channel;
  user: User;
  role: Role;
  members: Member[];
  revision: number;
}) {
  const key = `hub-draft:${user.id}:${channel.id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(key) ?? "");
  const [pending, setPending] = useState<Pending[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`${key}:pending`) ?? "[]").map(
        (p: Pending) => ({ ...p, state: "error" }),
      );
    } catch {
      return [];
    }
  });
  const notified = useRef<bigint | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [depth, setDepth] = useState(1);
  const [more, setMore] = useState(false);
  const [startBefore, setStartBefore] = useState<string | null>(null);
  const nextBefore = useRef<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const generation = useRef(0);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const remember = useCallback(() => {
    const el = view.current;
    if (!el || atBottom.current) return;
    const child = Array.from(
      el.querySelectorAll<HTMLElement>("[data-message]"),
    ).find(
      (e) => e.getBoundingClientRect().bottom > el.getBoundingClientRect().top,
    );
    if (child)
      anchor.current = {
        id: child.dataset.message!,
        top: child.getBoundingClientRect().top,
      };
  }, []);
  useEffect(() => {
    sessionStorage.setItem(key, draft);
  }, [key, draft]);
  useEffect(() => {
    sessionStorage.setItem(`${key}:pending`, JSON.stringify(pending));
  }, [key, pending]);
  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    async function refresh() {
      try {
        const all: ChatMessage[] = [];
        let before: string | null = startBefore;
        for (let page = 0; page < depth; page++) {
          const result: Page = await request(
            `/channels/${channel.id}/messages${before ? `?before=${before}` : ""}`,
          );
          all.unshift(...result.items);
          before = result.next;
          if (!before) break;
        }
        if (cancelled || current !== generation.current) return;
        if (all.length) {
          const max = all.reduce(
            (n, m) => (BigInt(m.sequence) > n ? BigInt(m.sequence) : n),
            0n,
          );
          if (
            notified.current !== null &&
            all.some(
              (m) =>
                BigInt(m.sequence) > notified.current! &&
                m.authorId !== user.id &&
                !m.deletedAt,
            )
          )
            window.hubDesktop?.notifyMessage();
          notified.current =
            max > (notified.current ?? 0n) ? max : (notified.current ?? 0n);
        }
        remember();
        setMessages(all);
        setMore(!!before);
        nextBefore.current = before;
        setError("");
        setPending((p) =>
          p.filter(
            (x) =>
              !all.some(
                (m) => m.clientId === x.clientId && m.authorId === user.id,
              ),
          ),
        );
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e));
          if (e instanceof ApiError && [401, 403, 404].includes(e.status))
            setMessages([]);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [channel.id, depth, revision, remember, user.id, startBefore]);
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else if (anchor.current) {
      const item = Array.from(
        el.querySelectorAll<HTMLElement>("[data-message]"),
      ).find((e) => e.dataset.message === anchor.current?.id);
      if (item)
        el.scrollTop += item.getBoundingClientRect().top - anchor.current.top;
    }
    anchor.current = null;
  }, [messages, pending]);
  async function deliver(item: Pending) {
    setPending((p) =>
      p.map((x) =>
        x.clientId === item.clientId ? { ...x, state: "sending" } : x,
      ),
    );
    try {
      const saved = await request<ChatMessage>(
        `/channels/${channel.id}/messages`,
        "POST",
        { clientId: item.clientId, content: item.content },
      );
      setError("");
      remember();
      setMessages((p) =>
        [...p.filter((m) => m.id !== saved.id), saved].sort((a, b) =>
          BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1,
        ),
      );
      setPending((p) => p.filter((x) => x.clientId !== item.clientId));
    } catch (e) {
      setError(errorText(e));
      setPending((p) =>
        p.map((x) =>
          x.clientId === item.clientId ? { ...x, state: "error" } : x,
        ),
      );
    }
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const item: Pending = {
      clientId: "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          Number(c) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] &
            (15 >> (Number(c) / 4)))
        ).toString(16),
      ),
      content: draft.trim(),
      state: "sending",
    };
    setPending((p) => [...p, item]);
    setDraft("");
    void deliver(item);
  }
  async function remove(message: ChatMessage) {
    try {
      await request(`/channels/${channel.id}/messages/${message.id}`, "DELETE");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <div
        className="messages"
        ref={view}
        onScroll={() => {
          const el = view.current!;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-label="Переписка"
      >
        {startBefore && (
          <button
            onClick={() => {
              setStartBefore(null);
              setDepth(1);
              atBottom.current = true;
            }}
          >
            К последним сообщениям
          </button>
        )}
        {more && (
          <button
            className="older"
            onClick={() => {
              remember();
              atBottom.current = false;
              if (depth < 20) setDepth((d) => d + 1);
              else {
                setStartBefore(nextBefore.current);
                setDepth(1);
                view.current?.scrollTo(0, 0);
              }
            }}
          >
            Загрузить старые сообщения
          </button>
        )}
        {busy && <p className="muted">Загружаем переписку…</p>}
        {!busy && messages.length === 0 && (
          <div className="chat-welcome">
            <div className="channel-symbol">#</div>
            <h2>Здесь начинается #{channel.name}</h2>
            <p className="muted">Поздоровайтесь и начните разговор.</p>
          </div>
        )}
        {messages.map((m) => (
          <article className="message" key={m.id} data-message={m.id}>
            <div className="avatar">{m.author.displayName.slice(0, 1)}</div>
            <div className="message-body">
              <header>
                <strong>{m.author.displayName}</strong>
                <time dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleString("ru", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                {m.editedAt && !m.deletedAt && <small>изменено</small>}
              </header>
              <p className={m.deletedAt ? "muted" : ""}>
                {m.deletedAt ? "Сообщение удалено" : m.content}
              </p>
              {m.authorId === user.id && !m.deletedAt && (
                <small className="sent">Отправлено</small>
              )}
            </div>
            {!m.deletedAt && (
              <div className="message-actions">
                {m.authorId === user.id && (
                  <button
                    aria-label="Редактировать сообщение"
                    onClick={() => setEditing(m)}
                  >
                    Изменить
                  </button>
                )}
                {canDeleteMessage(
                  role,
                  members.find((x) => x.userId === m.authorId)?.role ??
                    "MEMBER",
                  m.authorId === user.id,
                ) && (
                  <button
                    aria-label="Удалить сообщение"
                    onClick={() => void remove(m)}
                  >
                    Удалить
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {pending.map((p) => (
          <article className="pending" key={p.clientId}>
            <p>{p.content}</p>
            <small>
              {p.state === "sending" ? "Отправляется…" : "Ошибка отправки"}
            </small>
            {p.state === "error" && (
              <button onClick={() => void deliver(p)}>
                Повторить отправку
              </button>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="error chat-error">
          {error}
        </p>
      )}
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor="message-input">
          Сообщение
        </label>
        <textarea
          id="message-input"
          placeholder={`Написать в #${channel.name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          rows={2}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <button className="primary" disabled={!draft.trim()}>
          Отправить
        </button>
        <small>Enter — отправить · Shift + Enter — новая строка</small>
      </form>
      {editing && (
        <Modal title="Изменить сообщение" close={() => setEditing(null)}>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const content = new FormData(e.currentTarget).get("content");
              try {
                await request(
                  `/channels/${channel.id}/messages/${editing.id}`,
                  "PATCH",
                  { content },
                );
                setEditing(null);
              } catch (error) {
                setError(errorText(error));
              }
            }}
          >
            <label htmlFor="edit-content">Текст</label>
            <textarea
              id="edit-content"
              name="content"
              defaultValue={editing.content}
              maxLength={4000}
              required
              autoFocus
            />
            <button className="primary">Сохранить</button>
          </form>
        </Modal>
      )}
    </>
  );
}
