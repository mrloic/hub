import { roleLabel, canAssignRole } from "../../../../packages/shared/src";
import { useEffect, useState } from "react";
import {
  canKick,
  canManage,
  type Channel,
  type Community,
  type Invite,
  type Member,
  type User,
} from "../../../../packages/shared/src";
import { errorText, request } from "../api";
import { Modal } from "./Modal";
export function Settings({
  voiceEnabled,
  community,
  members,
  channels,
  user,
  close,
  refresh,
}: {
  voiceEnabled: boolean;
  community: Community;
  members: Member[];
  channels: Channel[];
  user: User;
  close: () => void;
  refresh: () => void;
}) {
  const [error, setError] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    text: string;
    path: string;
    method: string;
    body?: unknown;
  } | null>(null);
  const base = `/communities/${community.id}`;
  const manager = canManage(community.role);
  async function loadInvites() {
    if (manager)
      try {
        setInvites(await request(`${base}/invites`));
      } catch (e) {
        setError(errorText(e));
      }
  }
  useEffect(() => {
    void loadInvites();
  }, [base, manager]);
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(path, method, body);
      refresh();
      await loadInvites();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Настройки сообщества" close={close}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {confirm ? (
        <div>
          <p>{confirm.text}</p>
          <div className="row">
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (await action(confirm.path, confirm.method, confirm.body)) {
                  setConfirm(null);
                  close();
                }
              }}
            >
              Подтвердить
            </button>
            <button onClick={() => setConfirm(null)}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="settings">
          {manager && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(base, "PATCH", {
                    name: new FormData(e.currentTarget).get("name"),
                  });
                }}
              >
                <label>
                  Название сообщества
                  <input
                    name="name"
                    defaultValue={community.name}
                    maxLength={80}
                    required
                  />
                </label>
                <button disabled={busy}>Сохранить название</button>
              </form>
              <h3>Каналы</h3>
              {channels.map((c) => (
                <form
                  key={c.id}
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(`${base}/channels/${c.id}`, "PATCH", {
                      name: new FormData(e.currentTarget).get("name"),
                    });
                  }}
                >
                  <input
                    name="name"
                    defaultValue={c.name}
                    aria-label={`Название канала ${c.name}`}
                    maxLength={80}
                    required
                  />
                  <button disabled={busy}>Сохранить</button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Удалить канал ${c.name}`}
                    onClick={() =>
                      setConfirm({
                        text: `Удалить канал «${c.name}» и всю его историю?`,
                        path: `${base}/channels/${c.id}`,
                        method: "DELETE",
                      })
                    }
                  >
                    Удалить
                  </button>
                </form>
              ))}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  if (
                    await action(`${base}/channels`, "POST", {
                      name: new FormData(form).get("name"),
                      type: new FormData(form).get("type") ?? "TEXT",
                    })
                  )
                    form.reset();
                }}
              >
                <label>
                  Новый канал
                  <input
                    name="name"
                    placeholder="например, идеи"
                    required
                    maxLength={80}
                  />
                </label>
                {voiceEnabled && (
                  <label>
                    Тип канала
                    <select name="type" defaultValue="TEXT">
                      <option value="TEXT">Текстовый</option>
                      <option value="VOICE">Голосовой</option>
                    </select>
                  </label>
                )}
                <button disabled={busy}>Создать канал</button>
              </form>
              <h3>Приглашения</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  await action(`${base}/invites`, "POST", {
                    hours: Number(data.get("hours")),
                    maxUses: Number(data.get("maxUses")),
                  });
                }}
              >
                <div className="row">
                  <label>
                    Срок, часов
                    <input
                      name="hours"
                      type="number"
                      min={1}
                      max={720}
                      defaultValue={24}
                      required
                    />
                  </label>
                  <label>
                    Лимит входов
                    <input
                      name="maxUses"
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={10}
                      required
                    />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  Создать приглашение
                </button>
              </form>
              {invites.length === 0 && (
                <p className="muted">Приглашений пока нет.</p>
              )}
              {invites.map((i) => (
                <div className="invite" key={i.id}>
                  <label>
                    Ссылка-приглашение
                    <input
                      readOnly
                      value={i.url}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <small>
                    {i.uses}/{i.maxUses} входов · до{" "}
                    {new Date(i.expiresAt).toLocaleString("ru")}
                  </small>
                  {i.revokedAt ? (
                    <span>Отозвано</span>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(`${base}/invites/${i.id}`, "DELETE")
                      }
                    >
                      Отозвать
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
          <h3>Участники</h3>
          {members.map((m) => (
            <div className="member-settings" key={m.userId}>
              <span>
                {m.user.displayName}{" "}
                <small>
                  @{m.user.username} · {roleLabel[m.role]}
                </small>
              </span>
              {m.userId !== user.id && (
                <>
                  {(["MEMBER", "ADMIN", "CO_OWNER"] as const)
                    .filter(
                      (next) =>
                        next !== m.role &&
                        canAssignRole(community.role, m.role, next),
                    )
                    .map((next) => (
                      <button
                        key={next}
                        disabled={busy}
                        onClick={() =>
                          void action(`${base}/members/${m.userId}`, "PATCH", {
                            role: next,
                          })
                        }
                      >
                        {next === "MEMBER"
                          ? "Сделать участником"
                          : next === "ADMIN"
                            ? "Назначить администратором"
                            : "Назначить совладельцем"}
                      </button>
                    ))}
                  {community.role === "OWNER" && (
                    <button
                      onClick={() =>
                        setConfirm({
                          text: `Передать владение ${m.user.displayName}? Вы станете администратором.`,
                          path: `${base}/transfer`,
                          method: "POST",
                          body: { userId: m.userId },
                        })
                      }
                    >
                      Передать владение
                    </button>
                  )}
                </>
              )}
              {m.userId !== user.id && canKick(community.role, m.role) && (
                <button
                  className="danger"
                  onClick={() =>
                    setConfirm({
                      text: `Исключить ${m.user.displayName}?`,
                      path: `${base}/members/${m.userId}`,
                      method: "DELETE",
                    })
                  }
                >
                  Исключить
                </button>
              )}
            </div>
          ))}
          <hr />
          {community.role === "OWNER" ? (
            <button
              className="danger"
              onClick={() =>
                setConfirm({
                  text: `Удалить сообщество «${community.name}», все каналы и сообщения? Это действие необратимо.`,
                  path: base,
                  method: "DELETE",
                })
              }
            >
              Удалить сообщество
            </button>
          ) : (
            <button
              className="danger"
              onClick={() =>
                setConfirm({
                  text: "Выйти из сообщества?",
                  path: `${base}/leave`,
                  method: "POST",
                })
              }
            >
              Выйти из сообщества
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
