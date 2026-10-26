# Тестирование

Рабочая БД `hub` и volume `hub_postgres-data` не очищаются и не используются тестами.
`compose.test.yaml`: отдельная Docker-сеть, БД `hub_test`, volume
`hub-test_test-postgres`, без host ports. Известный тестовый пароль допустим только
в этом изолированном файле. Тесты отказываются работать без APP_ENV=test;
интеграционные также проверяют окончание DATABASE_URL `/hub_test`.

## Быстрые проверки (Ubuntu)

С Node 24 (локальный `.tools/bin` или уже доступный Node):

```bash
export PATH="$PWD/.tools/bin:$PATH"
npm ci
npm run generate
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm audit
sudo docker compose config --quiet
```

Без Node на хосте lint/typecheck/unit можно запустить в `migrate`-контейнере,
заменив команду: `sudo docker compose run --rm migrate npm run lint` и т.д.

## Полный набор с PostgreSQL и Chromium

Сначала собрать актуальные `hub-api:local` и `hub-web:local`:

```bash
sudo docker compose build api web
sudo bash scripts/test.sh
```

Скрипт запускает test DB, применяет миграции, API/Caddy, собирает runner на
официальном Playwright-образе, выполняет `npm run test:integration`,
`npm run test:e2e`, перезапускает PostgreSQL/API/Caddy и повторяет тест сохранности.
Затем останавливает тестовые сервисы. Volumes сохраняются. Работает один browser worker.
Ошибки не скрываются. При падении контейнер browser остаётся для диагностики:

```bash
sudo docker logs hub-test-browser
sudo docker cp hub-test-browser:/app/playwright-report ./artifacts/playwright-report
```

После изучения отчёта можно удалить **только временный контейнер тестового runner**:
`sudo docker rm hub-test-browser`. Это не удаляет БД/volumes.
Скрипт копирует desktop/mobile screenshots в `artifacts` (не Git).
Состояние браузера для проверки restart хранится только в тестовом volume, содержит
тестовые cookie и не должно публиковаться. В тестовой БД перед интеграционным
набором очищаются только RateLimit; аккаунты/сообщества получают случайные имена.

Точечный повтор:

```bash
sudo docker compose -f compose.test.yaml up -d --wait db api web
sudo docker compose -f compose.test.yaml run --rm runner npm run test:integration
sudo docker compose -f compose.test.yaml run --rm runner npm run test:e2e
sudo docker compose -f compose.test.yaml stop
```

## Ручной сценарий

1. Через localhost зарегистрировать Алису (логин ASCII, имя может быть русским).
2. Создать сообщество. В настройках создать текстовый канал и приглашение.
3. В другом профиле/приватном окне открыть ссылку, зарегистрировать Бориса,
   нажать «Присоединиться», выбрать тот же канал.
4. Отправить по сообщению: обе страницы обновляются без reload.
5. Изменить своё сообщение и удалить: у другого участника правка/заглушка.
6. Обновить страницы и перезапустить сервисы: история и сессии сохраняются.
7. Отключить сеть во втором контексте, отправить сообщение, включить сеть и нажать
   «Повторить отправку»: одна запись. Неотправленный черновик остаётся.
8. Третий аккаунт вне сообщества не имеет доступа. Исключить Бориса: открытый
   экран очищается. Проверить роли ADMIN/MEMBER, запрет выхода владельца.
9. Телефон 390px, Tab/Shift+Tab/Escape в dialogs, длинные имена/сообщения.

Сводка фактически выполненных проверок — [test-results.md](test-results.md).
Тесты не являются замером нагрузки и не доказывают готовность к интернету.


## Голосовой этап

Полный `sudo bash scripts/test.sh` теперь поднимает также изолированный LiveKit
без host ports. `tests/integration/voice.test.ts` проверяет настоящую выдачу JWT,
минимальные grants, отказ постороннему/TEXT/несуществующему каналу, подмену room,
смену lease, stale leave, kick, удаление канала и logout. Секреты только тестовые.

`tests/e2e/voice.spec.ts` подключает два Chromium context к настоящему LiveKit,
включает синтетический микрофон, читает реальный inbound-rtp bytesReceived, проверяет
speaker indicator, mic/deafen, сохранение связи при выборе текста, смену голоса,
reconnect после истечения исходного 60-секундного JWT, отказ в разрешении микрофона, kick/delete/logout. Текстовые e2e остаются в общем наборе.

Runner запускает `scripts/with-media-tunnel.mjs`: loopback TCP-forward 8080 → Caddy
и 7881 → LiveKit, аналог обоих SSH -L. Интеграционные тесты также запускаются через
этот wrapper. APP_URL/TEST_BASE_URL тестов — http://localhost:8080. Создаётся WAV tone.
Только тестовый Chromium получает fake-media flags; secure-context и loopback
security flags не требуются. Настоящий браузер использует localhost и микрофон.

Точечный голосовой e2e после сборки и запуска тестовых сервисов:

```bash
sudo docker compose -f compose.test.yaml run --rm runner node scripts/with-media-tunnel.mjs npm run test:e2e -- tests/e2e/voice.spec.ts
```

Физические микрофоны, качество звука человеком, две отдельные машины, UDP/NAT/TURN
и публичный маршрут требуют ручной проверки по [voice-local.md](voice-local.md).

Голосовой e2e намеренно выдерживает 65 секунд до разрыва: проверяется реальное
обновление токена SFU, без подмены часов или сетевых ответов. Разрешение микрофона
выдаётся и отзывается средствами браузера; fake device/file/UI нужны headless Chromium.

## Подготовка production (без DNS/NAT)

```bash
export PATH="$PWD/.tools/bin:$PATH"
npm run lint
npm run typecheck
npm run test:unit
npm run build
node scripts/check-bundle.mjs
sudo docker compose --parallel 1 build api web
sudo bash scripts/test.sh
sudo docker compose --parallel 1 --env-file .env.production.example -f compose.production.yaml build api web
sudo docker compose --env-file .env.production.example -f compose.production.yaml config --quiet
sudo bash scripts/test-turn.sh
sudo bash scripts/test-edge.sh
```

`test.sh` выполняет npm run test:integration/test:e2e в изолированном runner, добавляя
production-api без host ports. Тот же voice integration повторяется с APP_ENV=production:
Secure/HttpOnly/Strict cookie, точный APP_URL, RTC без domain cookie, отзыв и подмена токена.

`test-turn.sh` — отдельный проект hub-turn-test, отдельная БД/volumes, без host ports.
Шаблон production LiveKit использует зарезервированный 203.0.113.1 вместо настоящего
IP и отдельную сеть 172.30.225.0/24. В Playwright принудительно relay-only ICE;
временные credentials берутся от настоящего SFU. Runner и SFU находятся в разных
Docker-сетях; прямая доступность SFU проверяется как запрещённая. Тестовый браузер обращается к
тестовому TCP proxy после TLS-границы; тот передаёт настоящий PROXY v2 в SFU.
Тест проверяет policy=relay, выбранную ICE-пару и реальные audio bytes,
reconnect, kick/logout/delete. Это **не проверка внешнего TURN/TLS**.

`test-edge.sh` запускать **после** test-turn.sh, не параллельно. Использует его
изолированные сервисы. Создаёт однодневный тестовый CA и сертификат в .runtime/checks,
явно доверяет этому CA только внутри Node-проверки; системное хранилище не меняется,
TLS verification не выключается. В тестовой копии Caddy заменён только источник
сертификата. Проверяются настоящий TLS/SNI всех трёх имён, SPA, asset 404, JSON API,
RTC allowlist, STUN binding через TURN/TLS и отказ анонимному TURN Allocate (401). Production продолжает использовать ACME,
тестовые сертификаты не монтируются в production. Тест не получает публичный сертификат.

Оба скрипта останавливают свои сервисы; volumes сохраняются. Не запускать одновременно
обычный и TURN-набор из-за общего test runner image. Перед повтором edge заменить
тестовые ключи можно только при остановленном edge-check; скрипт делает это штатно.
Результаты текущего выполнения — [production-checks.md](production-checks.md).


Особенность embedded TURN за NAT: relay объявляет внешний node_ip, а его пакеты
приходят к SFU по частному адресу. ICE может обозначить производный выбранный
кандидат как **prflx**. Поэтому одного candidateType недостаточно: forced-relay
тест дополнительно проверяет policy=relay после setConfiguration и изолирует
клиента от сети SFU. Наличие звука при запрещённом прямом маршруте подтверждает relay.

## CO_OWNER, диалоги и экран

`tests/unit/features.test.ts` проверяет матрицу CO_OWNER и feature detection
микрофона. Integration проверяет OWNER/CO_OWNER/ADMIN/MEMBER, запреты self/peer
escalation, каналы обоих типов; voice тест проверяет точный список grants.
`tests/e2e/modal.spec.ts`: фон, содержимое, Escape, восстановление focus и отмена
destructive confirmation. `tests/e2e/voice.spec.ts`: реальные LiveKit аудио/видео,
фиксированные размеры карточки, настройки обработки, экран двух издателей,
просмотр/остановка, browser-ended event и cleanup. Chromium получает настоящий
getDisplayMedia через автоматический выбор тестового источника; backend/SFU
не подменяются. Browser-ended моделируется остановкой native track и событием ended,
это не ручное нажатие панели Windows.

Ручной сценарий: [voice-features.md](voice-features.md). Не запускать тестовый reset,
миграции test или тестовые регистрации против production. Общие команды выше
используют отдельный Compose-проект. Результаты нового этапа: features-checks.md.

## Desktop / RNNoise

`npm run test:unit` включает настоящий RNNoise WASM, синтетический PCM, VAD/hysteresis,
gain/PTT, миграцию настроек, permission allowlist, shortcut/tray логику.
`npm run desktop:build` собирает общий frontend и Electron main/preload на Ubuntu.
`sudo bash scripts/test.sh` использует изолированные PostgreSQL/LiveKit и Chromium:
добавлен локальный AudioWorklet/RNNoise/fallback тест, проверка индивидуальной громкости.
OS-specific installer/capture/global key release/hardware routing проверяются на Windows
по windows-desktop.md. Сводка фактически выполненных проверок — desktop-checks.md.

Дополнительная завершающая проверка аудио и диалогов через изолированное окружение TURN:

```bash
sudo bash scripts/test-turn.sh tests/e2e/audio.spec.ts tests/e2e/modal.spec.ts
sudo bash scripts/test-edge.sh
```

TURN runner очищает только RateLimit своего тестового PostgreSQL перед повтором;
production БД не используется. Windows Native API остаются отдельной ручной проверкой.
