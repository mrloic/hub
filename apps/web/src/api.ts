let csrf = "";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  notifyExpired = true,
): Promise<T> {
  if (method !== "GET" && !csrf)
    csrf = (await request<{ csrf: string }>("/auth/csrf")).csrf;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Hub-CSRF": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response
    .json()
    .catch(() => ({ message: "Сервис временно недоступен." }));
  if (!response.ok) {
    if (response.status === 401 && notifyExpired)
      window.dispatchEvent(new Event("session-expired"));
    if (response.status === 403) csrf = "";
    throw new ApiError(
      response.status,
      data.message ?? "Не удалось выполнить запрос.",
    );
  }
  return data;
}
export function errorText(error: unknown) {
  if (error instanceof TypeError)
    return "Нет соединения. Проверьте сеть и попробуйте снова.";
  return error instanceof Error
    ? error.message
    : "Нет соединения. Попробуйте снова.";
}
