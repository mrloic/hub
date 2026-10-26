# Проверки Windows/audio этапа

Дата: 16 сентября 2026. Среда выполнения — Ubuntu, Docker и Chromium Playwright.
Production не обновлялся: API, PostgreSQL, LiveKit и Caddy остались healthy.
Миграции/смена secrets/DNS/NAT/удаление volumes не выполнялись.

## Выполнено

- `npm run lint` и `npm run typecheck` (включая Electron main/preload).
- `npm run test:unit`: 17 успешных тестов, включая настоящий RNNoise WASM,
  синтетические PCM fixtures, VAD/hysteresis, gain/PTT, key release state,
  settings migrations/persistence, device fallback и participant volume.
- `npm run build`, `npm run desktop:build`, Docker production-сборка frontend/API.
  Vite предупреждает о размере основного bundle; Enhanced вынесен в отдельный lazy asset.
- Compose config: local, test и production — успешно, без вывода secrets.
- PostgreSQL/API integration: 14 тестов; production voice gateway: 1 тест.
- Browser e2e: пять основных сценариев успешно; отдельный restart PostgreSQL/API/Caddy —
  один успешный сценарий. Итого шесть, включая фактический Standard fallback, input/output
  switching и нулевую громкость после reconnect.

- Принудительный TURN: три успешных browser tests (audio/RNNoise, modal, voice),
  прямой доступ runner к SFU исключён тестовой сетью.
- TLS/SNI edge: маршруты Hub/API/RTC, доверенная тестовая цепочка сертификатов и
  TURN binding — успешно; неавторизованный Allocate отвергнут с 401.
- Сканирование web/desktop assets: значения production secrets не обнаружены;
  значения не выводились.

Итоговые логи: `.runtime/desktop-acceptance.log`, `desktop-turn-acceptance.log`,
`desktop-edge-acceptance.log`, `desktop-{lint,typecheck,unit}-final.log` и
`desktop-package-source-final.log`. Промежуточные неуспешные прогоны исправлены;
в частности, тестами обнаружены фактический Standard fallback Chromium и очистка
отсоединённых LiveKit audio elements. Последующие полные прогоны успешны.
Логи без секретов production: `.runtime/desktop-*.log` (не коммитятся).
Снимки тестового UI: `artifacts/audio-settings.png`, `artifacts/audio-devices.png`,
`artifacts/turn/`. Traces содержат только тестовые аккаунты и исключены из Git.

## Что проверяет браузер

Настоящие API, PostgreSQL и LiveKit; два независимых аккаунта, текст/edit/delete,
права/отзыв доступа, голос/mute/deafen/reconnect, несколько screen shares и завершение.
Chromium использует синтетические media devices, не физический микрофон Ubuntu.
Новый AudioWorklet тест выполняет RNNoise, переключает input, проверяет meter/PTT,
отсутствие PeerConnection в локальном тесте, остановку capture и сохранение настроек.
Для отказа Enhanced отдельная тестовая CSP запрещает WASM: проверяются Standard
в UI и **noiseSuppression=true у реально захваченной дорожки**. Обычная CSP не ослаблена.
Output проверяется по sinkId remote audio, participant volume — по фактической
громкости элементов, включая reconnect. Внешнее акустическое качество этим не измеряется.

## Не выполнено здесь

Windows installer не собран/не запущен: по заданию нужны настоящая Windows x64,
без Wine/VM на сервере. Не подтверждены Electron runtime/cookie forwarding на Windows,
SmartScreen, установка/удаление/ярлыки, tray/автозапуск, global shortcuts в игре,
физический hotplug/routing, loopback/system audio и слуховая оценка RNNoise.
Main/preload компилируются, общая логика покрыта unit; это не заменяет OS-проверку.
Подробный ручной checklist и команды — windows-desktop.md.

Снимки нового диалога настроек просмотрены на Ubuntu. Ручной звонок с двумя людьми,
физическим микрофоном и реальным Windows screen selector не выполнялся.
