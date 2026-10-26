import { useState, type FormEvent } from "react";
import type { User } from "../../../../packages/shared/src";
import { errorText, request } from "../api";
export function Auth({
  signedIn,
  expired,
}: {
  signedIn: (user: User) => void;
  expired: boolean;
}) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      signedIn(
        await request<User>(
          `/auth/${register ? "register" : "login"}`,
          "POST",
          data,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">
          Hub<span>●</span>
        </div>
        <p className="eyebrow">ВАШЕ МЕСТО ДЛЯ ОБЩЕНИЯ</p>
        <h1>{register ? "Создайте аккаунт" : "С возвращением"}</h1>
        <p className="muted">Сообщества, разговоры и люди — в одном месте.</p>
        {expired && (
          <p role="status">
            Сессия завершена. Войдите снова. Неотправленные сообщения сохранены
            в этом браузере.
          </p>
        )}
        {location.pathname.startsWith("/invite/") && (
          <p className="notice">
            Вас пригласили в сообщество. Войдите или зарегистрируйтесь, чтобы
            присоединиться.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            Логин
            <input
              name="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]{3,32}"
              autoComplete="username"
              autoFocus
            />
          </label>
          <small>3–32 латинских буквы, цифры или _. Регистр не важен.</small>
          {register && (
            <label>
              Отображаемое имя
              <input
                name="displayName"
                required
                maxLength={64}
                autoComplete="nickname"
              />
            </label>
          )}
          <label>
            Пароль
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          <small>От 12 до 128 символов.</small>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Подождите…" : register ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Уже есть аккаунт? Войти" : "Создать аккаунт"}
        </button>
      </section>
    </main>
  );
}
