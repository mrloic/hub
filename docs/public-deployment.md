# Публичный запуск Hub

Конфигурация подготовлена, **публичный запуск пока не выполнен**. Все пункты
[USER ACTION] выполняет владелец. Команды Ubuntu — из `~/projects/hub`.
Не запускать production до DNS/NAT и проверки firewall. Не использовать `down -v`.

## До переключения

Сохранить backup, `.env` и текущий код в защищённом месте; дампы содержат личные данные.
Текущая БД использует `hub_postgres-data`. Production объявляет этот volume external:
при отсутствии запуск завершится ошибкой, а не создаст пустую БД. Имя Compose-проекта
остаётся `hub`, сервис db и имя базы не меняются. Local и production **нельзя запускать
одновременно** в одном проекте. Версии PostgreSQL и схема БД на этом этапе не меняются.

## 1. DNS Beget — [USER ACTION]

Создать три A-записи по [dns-beget.md](dns-beget.md). Это **первый внешний шаг**.
Проверить их через независимый DNS. Другие записи не менять.

## 2. Роутер — [USER ACTION]

Применить только [три правила NAT](router-ports.md) на <UBUNTU_LAN_IP>.
Не включать DMZ/UPnP, не открывать SSH. Если ISP блокирует 80/443, остановиться:
не обходить TLS самоподписанным сертификатом.

## 3. Production Compose — [USER ACTION]

[USER ACTION] Подготовить конфигурацию (системный Node не требуется):

```bash
export PATH="$PWD/.tools/bin:$PATH"
node scripts/prepare-production.mjs
```

Скрипт сохраняет пароль существующей БД, APP_SECRET и ключи LiveKit из `.env`,
генерирует отдельный PROXY_SECRET; существующий `.env.production` не перезаписывает.
В локальном `.env.production` вручную заменить **только** `<PUBLIC_IPV4>` своим адресом.
Файл игнорируется Git, права 0600. Не вставлять адрес в отслеживаемые файлы.
Если локального Node нет, тот же скрипт можно выполнить установленным Node-образом:

```bash
sudo docker run --rm --network none --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.21.0-bookworm-slim node scripts/prepare-production.mjs
```

После редактирования (аналогично можно через Node-контейнер):

```bash
node scripts/render-production.mjs
sudo docker volume inspect hub_postgres-data --format '{{.Name}}'
sudo docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

Не запускать `config` без `--quiet`: раскрывает секреты. Убедиться, что существующий
volume действительно смонтирован в локальном db; не выбирать имя произвольно.
Резервные сертификатные volumes `hub_caddy-data`/`hub_caddy-config` будут новыми — это
не данные PostgreSQL. Проверить отсутствие занятых 80/443/7882 и пересечения сети
172.30.224.0/24; выполнить [firewall-план](firewall.md), сохранив SSH.

Сборка не запускает Caddy и не выпускает сертификаты. Выполнить до остановки локального Hub:

```bash
sudo docker compose --parallel 1 --env-file .env.production -f compose.production.yaml build api web
```

В окно обслуживания остановить записи, сделать окончательный backup и переключиться:

```bash
sudo docker compose --profile voice stop api web livekit
sudo bash scripts/backup.sh local
sudo docker compose stop db
sudo docker compose --env-file .env.production -f compose.production.yaml up -d --wait db
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
sudo docker compose --env-file .env.production -f compose.production.yaml up -d --wait api livekit web
sudo docker compose --env-file .env.production -f compose.production.yaml ps
```

Миграции выполняются один раз отдельной командой. Последняя команда up начинает
публичную публикацию и ACME. Healthcheck Caddy подтверждает процесс, **не** сертификаты.
Контейнеры перезапускаются unless-stopped, логи ограничены. Не повторять полный
up с другим Compose project name: это создаст другой экземпляр, а БД должна быть одна.

## 4. Сертификаты — [USER ACTION]

Проверить `https://hub.mrloic.ru`, `https://rtc.mrloic.ru` (404 нормально), TLS
`turn.mrloic.ru:443` через `openssl s_client` по [диагностике](public-troubleshooting.md).
Все сертификаты должны проходить проверку доверия/имени без `-k`/исключений браузера.
Caddy использует HTTP-01; порт 80 нужен и для последующих продлений. Сохранить /data,
не пересоздавать сертификатный volume при обновлении. Не включать debug/access logs
для голосовых URL: query содержит краткоживущий JWT.

## 5. Сайт — [USER ACTION]

Из мобильной сети открыть Hub, зарегистрировать два аккаунта, создать сообщество,
приглашение, проверить чат/редактирование/удаление/refresh. В DevTools cookie:
Secure, HttpOnly, SameSite=Strict, без Domain. Приглашения начинаются с APP_URL.
Проверить прямой вложенный маршрут, отсутствующий `/assets/missing.js` (404),
неавторизованный API (JSON, не index.html). Не переносить локальные cookies вручную.

## 6. Socket.IO — [USER ACTION]

DevTools → Network → WS: соединение на hub.mrloic.ru/socket.io, статус 101.
Сообщения видны в независимых браузерах без refresh. Отключить сеть, вернуть:
история и права должны восстановиться. Выйти из аккаунта — соединение закрывается.

## 7. LiveKit — [USER ACTION]

Подключить два аккаунта к одному голосовому каналу, включить микрофоны.
Сигнализация идёт только через rtc.mrloic.ru/livekit, API /twirp снаружи закрыт.
Проверить смену текста без разрыва голоса, mute/deafen, выход, kick и удаление канала.

## 8. TURN — [USER ACTION]

Проверить на сети, где UDP недоступен, без изменения firewall рабочего Ubuntu.
Через `chrome://webrtc-internals` / `about:webrtc` найти выбранную ICE-пару:
локальный candidateType **relay**, TURN/TLS на turn.mrloic.ru:443, растущие audio bytes.
При private TURN → SFU ICE может показать производный **prflx**; тогда одного
типа кандидата недостаточно. Подтвердить звук при запрещённом прямом media UDP
на клиентской сети: ICE/TCP здесь выключен, остаётся только TURN/TLS.
Сам факт наличия TURN в списке кандидатов не доказывает его использование.
Не публиковать дамп webrtc-internals: содержит адреса/учётные данные.
Можно отдельно использовать изолированный forced-relay тест из [testing.md](testing.md);
он проверяет media relay, но не внешний TLS/NAT.

## 9. Две разные внешние сети — [USER ACTION]

Один клиент через мобильный интернет, другой через независимый домашний интернет.
Проверить двусторонний звук, reconnect, TURN fallback, Firefox и Chromium.
LAN-тест и SSH-туннель не заменяют эту проверку. IPv6-only/NAT64 отдельно не проверены.

## 10. Перезапуск Ubuntu — [USER ACTION]

В согласованное окно выполнить reboot, дождаться healthy контейнеров, проверить
историю, сессии, сертификаты и новый голосовой вызов. SSH только LAN.
Активный звонок может прерваться, его следует подключить заново.

## 11. Windows/Hyper-V — [USER ACTION]

Проверить параметры автоматического старта Hub-Server и внешнего виртуального коммутатора
в Hyper-V вручную. Затем согласованный reboot Windows: Ubuntu, Docker и Hub должны
восстановиться. Проект не меняет настройки Windows/VM и не заявляет это проверенным.

## 12. Откат — [USER ACTION]

Если ошибки: закрыть NAT-правила Hub на роутере, сохранить безопасные диагностические
результаты и остановить production. Базу/volumes не удалять и не восстанавливать поверх:

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml stop
sudo docker compose --profile voice up -d --wait db api livekit web
```

Локальные image tags и `.env` сохранены. В этом этапе миграции схемы не добавлены.
Если позже появились несовместимые миграции, откат кода отдельно проверить с копией БД.
Локальный доступ из CMD Windows:

```cmd
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 -L 127.0.0.1:7881:127.0.0.1:7881 hub
```

Открыть http://localhost:8080. Не запускать второй hub-proxy, не трогать прокси-туннель.
