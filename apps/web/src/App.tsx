import { DesktopCapture } from "./components/DesktopCapture";
import { ScreenViewer } from "./voice/ScreenViewer";
import { roleLabel } from "../../../packages/shared/src";
import { useVoice } from "./voice/useVoice";
import { VoicePanel } from "./voice/VoicePanel";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type {
  Channel,
  Community,
  Member,
  User,
} from "../../../packages/shared/src";
import { errorText, request } from "./api";
import { Auth } from "./components/Auth";
import { Chat } from "./components/Chat";
import { Modal } from "./components/Modal";
import { Settings } from "./components/Settings";
type Detail = Community & { channels: Channel[]; members: Member[] };
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const voice = useVoice(user);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [cid, setCid] = useState(
    location.pathname.startsWith("/c/") ? location.pathname.split("/")[2] : "",
  );
  const [chid, setChid] = useState(location.pathname.split("/")[4] ?? "");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("Подключение…");
  const [modal, setModal] = useState<
    "create" | "join" | "profile" | "settings" | null
  >(location.pathname.startsWith("/invite/") ? "join" : null);
  const [invite, setInvite] = useState(
    location.pathname.startsWith("/invite/")
      ? location.pathname.split("/")[2]
      : "",
  );
  const [error, setError] = useState("");
  const [members, setMembers] = useState(false);
  const [navigation, setNavigation] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    void request<User>("/auth/me", "GET", undefined, false)
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
    const expire = () => {
      setUser(null);
      setDetail(null);
      setCommunities([]);
      setExpired(true);
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  useEffect(() => {
    if (!user) return;
    const socket = io({ withCredentials: true, transports: ["websocket"] });
    socket.on("connect", () => {
      setStatus("На связи");
      refresh();
    });
    socket.on("refresh", refresh);
    socket.on("disconnect", (reason) => {
      setStatus("Переподключение…");
      if (reason === "io server disconnect")
        void request("/auth/me")
          .then(() => socket.connect())
          .catch(() => {});
    });
    socket.on("connect_error", () => {
      setStatus("Нет соединения · повторяем");
      void request("/auth/me").catch(() => {});
    });
    const poll = setInterval(refresh, 5000);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      socket.disconnect();
      clearInterval(poll);
      window.removeEventListener("focus", focus);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    void request<Community[]>("/communities")
      .then((list) => {
        if (!active) return;
        setCommunities(list);
        if (!list.some((c) => c.id === cid)) {
          setCid(list[0]?.id ?? "");
          setDetail(null);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [user?.id, revision, cid]);
  useEffect(() => {
    if (!user || !cid) {
      setDetail(null);
      return;
    }
    let active = true;
    void request<Detail>(`/communities/${cid}`)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        if (!data.channels.some((c) => c.id === chid))
          setChid(data.channels[0]?.id ?? "");
      })
      .catch((e) => {
        if (active) {
          setDetail(null);
          setError(errorText(e));
        }
      });
    return () => {
      active = false;
    };
  }, [user?.id, cid, chid, revision]);
  useEffect(() => {
    if (cid && chid && modal !== "join")
      history.replaceState(null, "", `/c/${cid}/ch/${chid}`);
  }, [cid, chid, modal]);
  if (loading) return <main className="loading">Загружаем Hub…</main>;
  if (!user)
    return (
      <Auth
        expired={expired}
        signedIn={(u) => {
          setUser(u);
          setExpired(false);
          setError("");
        }}
      />
    );
  const channel =
    detail?.id === cid ? detail.channels.find((c) => c.id === chid) : undefined;
  async function submit(path: string, method: string, data: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await request<Record<string, string>>(path, method, data);
      refresh();
      setModal(null);
      return result;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`app ${navigation ? "nav-open" : ""}`}>
      <nav className="community-rail" aria-label="Сообщества">
        <a className="hub-icon" href="/" aria-label="Hub — главная">
          H<span>•</span>
        </a>
        <div className="rail-divider" />
        {communities.map((c) => (
          <button
            key={c.id}
            className={`community-icon ${cid === c.id ? "selected" : ""}`}
            title={c.name}
            aria-label={`Сообщество ${c.name}`}
            aria-pressed={cid === c.id}
            onClick={() => {
              setCid(c.id);
              setDetail(null);
            }}
          >
            {c.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <button
          className="community-icon add"
          aria-label="Создать сообщество"
          title="Создать сообщество"
          onClick={() => {
            setError("");
            setModal("create");
          }}
        >
          +
        </button>
        <button
          className="community-icon"
          aria-label="Присоединиться по приглашению"
          title="Присоединиться"
          onClick={() => {
            setError("");
            setModal("join");
          }}
        >
          ↗
        </button>
      </nav>
      <aside className="channel-sidebar">
        <header className="sidebar-header">
          <h1>{detail?.name ?? "Ваш Hub"}</h1>
          {detail && (
            <button
              aria-label="Настройки сообщества"
              onClick={() => {
                setError("");
                setModal("settings");
              }}
            >
              ⚙
            </button>
          )}
        </header>
        <div className="channel-list">
          <p className="eyebrow">КАНАЛЫ</p>
          {detail?.channels.map((c) => (
            <button
              className={`channel-item ${chid === c.id ? "active" : ""}`}
              key={c.id}
              onClick={() => {
                setChid(c.id);
                setNavigation(false);
              }}
            >
              <span>{c.type === "VOICE" ? "◉" : "#"}</span>
              {c.name}
            </button>
          ))}
          {detail?.channels.length === 0 && (
            <p className="muted">Каналов пока нет.</p>
          )}
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("voice-settings"))}
        >
          Голос и устройства
        </button>
        <footer className="profile">
          <div className="avatar">{user.displayName.slice(0, 1)}</div>
          <div className="profile-name">
            <strong>{user.displayName}</strong>
            <small>@{user.username}</small>
          </div>
          <button
            aria-label="Настройки профиля"
            onClick={() => {
              setError("");
              setModal("profile");
            }}
          >
            ⚙
          </button>
        </footer>
      </aside>
      <main className="conversation">
        <header className="chat-header">
          <button
            className="mobile-toggle"
            aria-label="Показать каналы"
            onClick={() => setNavigation(!navigation)}
          >
            ☰
          </button>
          <div>
            <strong>
              <span className="hash">
                {channel?.type === "VOICE" ? "◉" : "#"}
              </span>{" "}
              {channel?.name ?? "Добро пожаловать"}
            </strong>
            <small className="connection" role="status">
              {status}
            </small>
          </div>
          {detail && (
            <button
              className={members ? "active" : ""}
              aria-label="Показать участников"
              aria-pressed={members}
              onClick={() => setMembers(!members)}
            >
              Участники · {detail.members.length}
            </button>
          )}
        </header>
        <VoicePanel voice={voice} selected={channel} />
        <DesktopCapture />
        {error && !modal && (
          <p className="error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                refresh();
              }}
            >
              Повторить
            </button>
          </p>
        )}
        {voice.selectedScreen ? (
          <ScreenViewer
            name={
              voice.screens.find((s) => s.id === voice.selectedScreen)?.name ??
              "Трансляция остановлена"
            }
            track={
              voice.screens.find((s) => s.id === voice.selectedScreen)?.track
            }
            close={() => voice.selectScreen(null)}
          />
        ) : channel?.type === "VOICE" ? (
          <section className="empty">
            <h2>Голосовой канал «{channel.name}»</h2>
            <p className="muted">
              Микрофон при входе выключен. Во время разговора можно
              переключаться в текстовые каналы.
            </p>
          </section>
        ) : channel && detail ? (
          <Chat
            key={`${user.id}:${channel.id}`}
            channel={channel}
            user={user}
            role={detail.role}
            members={detail.members}
            revision={revision}
          />
        ) : (
          <section className="empty">
            <div className="brand">
              Hub<span>●</span>
            </div>
            <h2>
              {communities.length
                ? "Место для ваших разговоров"
                : "Начните своё сообщество"}
            </h2>
            <p className="muted">
              Создайте пространство для друзей или присоединитесь по
              приглашению.
            </p>
            <div className="row">
              <button className="primary" onClick={() => setModal("create")}>
                Создать сообщество
              </button>
              <button onClick={() => setModal("join")}>Присоединиться</button>
            </div>
          </section>
        )}
      </main>
      {members && detail && (
        <aside className="members-panel">
          <div className="dialog-heading">
            <h2>Участники</h2>
            <button
              aria-label="Скрыть участников"
              onClick={() => setMembers(false)}
            >
              ×
            </button>
          </div>
          {detail.members.map((m) => (
            <div className="member" key={m.userId}>
              <div className="avatar">{m.user.displayName.slice(0, 1)}</div>
              <div>
                <strong>{m.user.displayName}</strong>
                <small>{roleLabel[m.role]}</small>
              </div>
            </div>
          ))}
        </aside>
      )}
      {modal === "settings" && detail && (
        <Settings
          voiceEnabled={voice.enabled}
          community={detail}
          channels={detail.channels}
          members={detail.members}
          user={user}
          close={() => setModal(null)}
          refresh={refresh}
        />
      )}
      {modal && modal !== "settings" && (
        <Modal
          title={
            modal === "create"
              ? "Создать сообщество"
              : modal === "join"
                ? "Присоединиться к сообществу"
                : "Ваш профиль"
          }
          close={() => setModal(null)}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {modal === "create" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await submit("/communities", "POST", {
                  name: new FormData(e.currentTarget).get("name"),
                });
                if (result) setCid(result.id);
              }}
            >
              <label>
                Название сообщества
                <input name="name" required maxLength={80} autoFocus />
              </label>
              <button className="primary" disabled={busy}>
                Создать
              </button>
            </form>
          )}
          {modal === "join" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const token = invite.trim().split("/").filter(Boolean).at(-1);
                const result = await submit("/invites/join", "POST", { token });
                if (result) {
                  setCid(result.communityId);
                  setInvite("");
                  history.replaceState(null, "", "/");
                }
              }}
            >
              <label>
                Ссылка или код приглашения
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <button className="primary" disabled={busy}>
                Присоединиться
              </button>
            </form>
          )}
          {modal === "profile" && (
            <>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await submit("/auth/profile", "PATCH", {
                    displayName: new FormData(e.currentTarget).get(
                      "displayName",
                    ),
                  });
                  if (result) setUser(result as unknown as User);
                }}
              >
                <p className="muted">Логин: @{user.username}</p>
                <label>
                  Отображаемое имя
                  <input
                    name="displayName"
                    defaultValue={user.displayName}
                    required
                    maxLength={64}
                    autoFocus
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Сохранить
                </button>
              </form>
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await request("/auth/logout", "POST");
                    setUser(null);
                    setDetail(null);
                    setCommunities([]);
                    setModal(null);
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Выйти из аккаунта
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
