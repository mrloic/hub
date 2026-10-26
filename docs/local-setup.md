# Локальный запуск

Все bash-команды выполняются на Ubuntu из корня репозитория. Docker Engine/Compose
уже установлены; их переустановка, смена групп и прав socket не нужны.

1. Проверить доступ: `sudo -n docker info --format '{{.ServerVersion}}'`.
2. Создать `.env` командой из README (или `npm run setup` при наличии Node 24).
3. `sudo docker compose config --quiet` — без печати конфигурации с секретами.
4. `sudo docker compose build api web` — фиксированные версии, `npm ci` по lock.
5. `sudo docker compose up -d --wait db`.
6. `sudo docker compose run --rm migrate` — единственный migrator.
7. `sudo docker compose up -d --wait api web`.
8. `curl --noproxy '*' http://localhost:8080/api/health` → `{"ok":true}`.

## Настройки

`.env` содержит APP_NAME=Hub, APP_ENV=local, APP_URL=http://localhost:8080,
VOICE_ENABLED=false, случайные POSTGRES_PASSWORD и APP_SECRET. Пароль БД — hex,
поэтому корректен в connection URL. `.env` создаётся с режимом 0600 и не перезаписывается.
Сессии живут 7 дней. APP_SECRET используется для CSRF, не следует менять его при
обычном обновлении. DATABASE_URL собирается Compose и не передаётся frontend.
Не меняйте POSTGRES_PASSWORD уже инициализированной БД простым редактированием .env:
это не изменяет пароль роли PostgreSQL. Согласованная ротация — отдельная операция.

APP_URL определяет единственный разрешённый Origin и ссылки приглашений.
Не подменять его адресом Ubuntu <UBUNTU_LAN_IP> или будущим доменом.
compose.yaml/Caddyfile предназначены только для local. Отдельный production требует
HTTPS и Secure cookie; переход описан в public-deployment.md, без изменения local .env.

## Доступ из Windows

Отдельное окно **CMD Windows**:

```cmd
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 hub
```

Браузер: http://localhost:8080. SSH alias `hub` предполагается уже настроенным.
Не использовать второй `hub-proxy`: он конфликтовал бы с прокси-перенаправлением.
В браузере HTTP/API/Socket.IO имеют один origin; cookie и CSRF соответствуют
localhost, приглашения открываются через тот же туннель. Туннель для браузера
не меняет существующий туннель инструментов. Для другого компьютера тоже нужен
разрешённый SSH-доступ, приложение не слушает всю LAN.

## Обновление и остановка

Перед обновлением — backup. Затем build → отдельный migrate → up, как в README.
API запускает готовый JS без компиляции и автоматических миграций.
`sudo docker compose stop` сохраняет контейнеры/данные; `up -d --wait` возвращает сервис.
Не использовать `down -v`, volume prune, reset. Restart policy основных сервисов —
unless-stopped. Проверка: `sudo docker compose ps`.

## Диагностика

- Браузер не открывается: проверить отдельный SSH-туннель и host bind `127.0.0.1:8080`.
- `sudo docker compose logs --tail=80 api` — безопасные логи маршрутов/классов ошибок.
  Не публиковать `.env`, cookie, полные конфигурации и приглашения.
- `sudo docker compose exec db pg_isready -U hub -d hub` — готовность PostgreSQL.
- Ошибки `npm ci`: сначала определить слой (host/sandbox/build/container/daemon).
  Переменные оболочки не распространяются автоматически на Docker daemon.
  Не копировать адрес loopback host-прокси внутрь контейнера: там это другой узел.
- В проверенном окружении Docker pull и npm внутри build работали без дополнительной
  настройки прокси. Если сеть изменится, остановиться на конкретной ошибке и
  согласовать минимальную настройку; TLS не отключать.
- Сессия истекла: войти заново. Черновик/очередь повтора сохраняются в sessionStorage
  вкладки и вернутся после входа в тот же аккаунт/канал. Закрытие вкладки может их удалить.

Первоначально Node отсутствовал; официальный Node 24.21.0 был распакован в `.tools`
с проверкой SHA-256. Системные пакеты на Ubuntu для разработки не устанавливались.
OpenSSL/CA добавляются только внутрь Docker-образа API.

## Голос

Для LiveKit выполните отдельную [инструкцию](voice-local.md). Она добавляет
loopback-порт 7881 и второе перенаправление SSH; одного 8080 достаточно только
для текста и сигнализации. Системная сеть и публичные порты не меняются.
