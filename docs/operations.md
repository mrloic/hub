# Эксплуатация Hub

Подробные инструкции запуска, обновления и размещения. Обзор проекта — в [README](../README.md).

Закрытый веб-сервис сообществ и текстовых каналов: React, NestJS, Socket.IO,
PostgreSQL/Prisma и Caddy. Текстовый этап и локальные голосовые каналы через self-hosted LiveKit.

## Запуск на Ubuntu

Из `~/projects/hub` (Node.js на хосте не обязателен):

```bash
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.21.0-bookworm-slim node scripts/setup.mjs
sudo docker compose config --quiet
sudo docker compose build api web
sudo docker compose up -d --wait db
sudo docker compose run --rm migrate
sudo docker compose up -d --wait api web
```

`setup` не перезаписывает `.env`. Миграции — отдельный однократный шаг.
Обычная остановка: `sudo docker compose stop`. Повторный запуск:
`sudo docker compose up -d --wait`. Данные остаются в volume.

## Открыть из Windows

В отдельном **CMD Windows**:

```cmd
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 hub
```

Открыть **http://localhost:8080**. Оставить это окно CMD работающим.
Это отдельное подключение для браузера, не второй `hub-proxy`.
В текстовом режиме опубликован только `127.0.0.1:8080`; API и PostgreSQL закрыты в Docker-сети.
Голос дополнительно использует loopback 7881, как описано ниже.

## Голос

OWNER/CO_OWNER/ADMIN создаёт канал типа «Голосовой» в настройках сообщества. Участники
подключаются явно, микрофон при входе выключен. Голос сохраняется при переключении
текстовых каналов. Кнопки микрофона, воспроизведения и выхода — в голосовой панели.

Подготовка и запуск на Ubuntu (существующий `.env` сохраняется, включается голос):

```bash
sudo docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.21.0-bookworm-slim node scripts/setup-voice.mjs
sudo docker compose build api web
sudo docker compose run --rm migrate
sudo docker compose --profile voice up -d --wait livekit api web
```

Для звука из Windows нужен дополнительный медиатуннель. Замените прежнее
**браузерное** SSH-подключение этой командой CMD (не меняйте `hub-proxy`):

```cmd
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 -L 127.0.0.1:7881:127.0.0.1:7881 hub
```

Повторный запуск голоса: `sudo docker compose --profile voice up -d --wait`.
Остановка всех компонентов: `sudo docker compose --profile voice stop`.

Затем http://localhost:8080. LiveKit API не опубликован; новый порт
127.0.0.1:7881 — только ICE/TCP. Подробности, две машины и ограничения:
[Локальный голос](voice-local.md).

## Проверить чат

Создать аккаунт, сообщество; в настройках сообщества создать канал и приглашение.
Открыть ссылку в другом профиле браузера или приватном окне, зарегистрировать второго
пользователя и присоединиться. Отправить сообщения с двух сторон, изменить/удалить
своё сообщение, обновить страницы. После `sudo docker compose restart` история
и авторизация должны сохраниться.

Автоматические проверки (изолированная БД, настоящий backend, Chromium):

```bash
sudo docker compose run --rm migrate npm run lint
sudo docker compose run --rm migrate npm run typecheck
sudo docker compose run --rm migrate npm run test:unit
sudo bash scripts/test.sh
```

Для разработки уже есть локальный Node в `.tools`, если он был подготовлен в этом
окружении: `export PATH="$PWD/.tools/bin:$PATH"`, затем `npm ci`, `npm run generate`.
Он не включён в Git и не нужен работающим контейнерам.

## Документы

- [Первый запуск и диагностика](local-setup.md)
- [Требования](spec.md), [архитектура и права](architecture.md)
- [Тестирование](testing.md), [результаты](test-results.md)
- [Безопасность](security.md), [резервное копирование](backup.md)
- [План развития](plan.md)

Публичное размещение пока не настроено: нет восстановления пароля, почты,
файлов и заявленной нагрузочной ёмкости. Публичная медиасеть не настроена. Это не готовность к интернет-запуску.


## Подготовка публичного размещения

Добавлен **отдельный** production-режим; текущий local не изменён.
Начните с [пошагового запуска](public-deployment.md), а не с `compose up`.
Первый внешний **[USER ACTION]** — три A-записи в [Beget](dns-beget.md).
Далее [NAT: 80/443 TCP, 7882 UDP](router-ports.md) и [firewall-план](firewall.md).
Публичные DNS, NAT и сертификаты автоматически не настраивались.

Файлы: `.env.production.example`, `compose.production.yaml`,
`infra/Caddyfile.production`, `infra/livekit.production.yaml`.
Production использует существующий external volume `hub_postgres-data`.
Команды подготовки (Ubuntu, локальный Node из .tools):

```bash
export PATH="$PWD/.tools/bin:$PATH"
node scripts/prepare-production.mjs
# USER ACTION: заполнить PUBLIC_IPV4 только в игнорируемом .env.production
node scripts/render-production.mjs
sudo docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

Сборка, backup, переключение и откат — строго по public-deployment.md.
Backup: `sudo bash scripts/backup.sh local` (после переключения — `production`).
[Диагностика](public-troubleshooting.md) · [Проверки подготовки](production-checks.md).

## Роли и новые голосовые функции

«Совладелец» управляет ADMIN/MEMBER и каналами; только владелец назначает
совладельцев, передаёт владение и удаляет сообщество.
В активном голосовом подключении доступны «Настройки голоса» (три настройки
WebRTC, включены по умолчанию) и «Демонстрация экрана». Выберите источник в
браузере; другой участник открывает трансляцию иконкой экрана на карточке автора.
Системный звук зависит от браузера и источника. Krisp Cloud не подключён.
Подробнее: [voice-features.md](voice-features.md).

Обновление существующего production (Ubuntu, после тестов):
```bash
sudo docker compose --parallel 1 --env-file .env.production -f compose.production.yaml build api web
sudo bash scripts/backup.sh production
sudo docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
sudo docker compose --env-file .env.production -f compose.production.yaml up -d --wait --no-deps api web
```
Миграция добавляет CO_OWNER к enum; прежние членства и volumes сохраняются.
Перезапуск API/web кратко прерывает соединения; обновите страницу и войдите в голос заново.

Обновление от 2026-09-16 уже применено к production после backup; результаты и
границы ручной проверки — [features-checks.md](features-checks.md).
Обновите страницу и переподключитесь к голосу для получения новых grants экрана.

## Windows-приложение и расширенный голос

Electron-клиент переиспользует React Hub и подключается к существующему production API.
Локальный RNNoise, VAD/PTT, устройства, gain и громкость собеседников доступны в
«Голос и устройства». Krisp и платные audio services не используются.

CMD Windows, Node 24.21.0, в корне копии репозитория:

```cmd
npm ci
npm run desktop:install-runtime
npm run desktop:dev
npm run desktop:package
```

Installer: `apps\desktop\release\Hub-Setup-0.2.0.exe`.
Подробности: [Windows](windows-desktop.md), [аудиотракт](audio-processing.md),
[RNNoise](rnnoise.md), [результаты и ограничения](desktop-checks.md).
Desktop не требует изменения production БД, DNS, NAT или LiveKit.

В этом этапе production-контейнеры не обновлялись. Desktop включает новую сборку React;
публичная веб-версия продолжает работать на прежнем образе. Серверное обновление
для запуска desktop не требуется; новые настройки в публичном браузере появятся
после отдельного обновления web image.
