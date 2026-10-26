export function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "Доступ к микрофону запрещён. Разрешите его в настройках сайта и повторите попытку.";
  if (name === "NotFoundError")
    return "Микрофон не найден. Подключите устройство.";
  if (name === "NotReadableError")
    return "Микрофон занят или недоступен. Проверьте другие приложения.";
  if (name === "NotSupportedError")
    return "Браузер не поддерживает захват микрофона. Попробуйте актуальный Chrome или Edge.";
  return "Не удалось включить микрофон. Проверьте разрешения и выбранное устройство.";
}
