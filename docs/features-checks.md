# Проверки UI, CO_OWNER и экрана — 2026-09-16

## Реализация

- Общий Modal: backdrop, Escape, focus restore, отмена destructive confirmation.
- CO_OWNER: shared matrix, серверные проверки, enum migration без изменения строк,
  управление ролями в UI. OWNER сохраняет критические ownership-операции.
- Настройки WebRTC: feature detection, сохранение предпочтений, live applyConstraints.
- Стабильная геометрия карточек; отдельные mic/screen icons, speaking border/glow.
- Native LiveKit screen share, выбранный video/audio subscription, contain/fullscreen,
  stop/ended/disconnect cleanup; камера/admin/data запрещены grants.
- Caddy: только display-capture policy разрешена для self. Сеть/секреты не менялись.

## Автоматические проверки

- npm run lint — успешно.
- npm run typecheck — успешно.
- npm run test:unit — 10 успешно.
- npm run build — успешно (предупреждения Vite о размере общего chunk и аннотациях Zod).
- npm run test:integration — 14 успешно с настоящей PostgreSQL/LiveKit.
- Отдельная production voice gateway integration — 1 успешно.
- npm run test:e2e — 4 сценария успешно + 1 сценарий после restart успешно.
  Пропуски разделяют обычную и restart-фазу; каждый из пяти сценариев выполнен.
- Forced TURN regression — 1 сценарий успешно, включая экран и исправленный layout.
- TLS/SNI/PROXY v2 edge: маршруты Hub/RTC и TURN binding — успешно;
  неавторизованный Allocate отклоняется с 401.
- Production Compose config и Caddy validation — успешно.
- Проверка трёх файлов frontend bundle на значения секретов проекта — успешно.
- Production api/web images — собраны.

Все функциональные тесты используют отдельные test volumes. Браузеры обращаются
к реальному API/SFU. Тестовый микрофон воспроизводит синтетический звук;
getDisplayMedia — native Chromium с автоматическим выбором тестового источника.
Browser-ended моделируется stop + ended на настоящем MediaStreamTrack.
Это не проверка физического Windows selector или аудиоустройства.

## Визуальный осмотр

Просмотрены реальные снимки Playwright desktop 1280×720 и mobile 390×844:
карточки стабильны, кнопки не накладываются, телефонная голосовая панель прокручивается.
Также просмотрены исправленный viewer удалённого экрана и production-форма входа.
Физический микрофон, субъективное качество подавления шума, звук Windows,
ручная кнопка Stop sharing браузера и звонок двух внешних сетей в этом этапе
не проверены. Предыдущий публичный голос работает по сообщению владельца.

## Production

Backup существующей PostgreSQL выполнен перед миграцией; список объектов custom
архива читается pg_restore. Новый backup не восстанавливался поверх рабочей БД.
Старые api/web images сохранены локальными тегами before-voice-features-20260916.
Применена `202609160004_co_owner`; сравнение количеств Membership по ролям до/после
совпало. Обновлены только api/web, PostgreSQL и LiveKit не пересоздавались.
Все четыре production-сервиса healthy. Был короткий перезапуск API/frontend,
из-за которого текущие соединения могли прерваться.

Chromium открыл production через HTTPS с настоящим сертификатом и локальным
маршрутом к Caddy (не внешний NAT): страница входа на вложенном маршруте,
Permissions-Policy display-capture=(self), API health, JSON 404 API и 404 отсутствующего
JS — успешно. Ошибок JavaScript страницы нет. Production-аккаунты для теста не создавались.
Снимок публичной формы входа сохранён в .runtime/features/public-login.png.
Обновление не меняло DNS/NAT/порты/секреты и production network topology.

После обновления пользователю достаточно обновить страницу и переподключиться
к голосу: старый уже выданный JWT мог иметь прежний microphone-only grant.
Теги старых images сохранены для диагностики/контролируемого отката. Старый backend
не знает CO_OWNER: после назначения новых ролей слепой откат образов недопустим.
Не удалять enum и не восстанавливать dump поверх рабочей БД без отдельного плана.

## Ограничения

Frontend Krisp недоступен на self-hosted согласно официальному Cloud-only hook.
Базовый WebRTC fallback работает. Захват экрана и системного звука зависит от
браузера/ОС/выбранного источника. Нагрузочные замеры не проводились.

## Найдено и исправлено при проверке

Chromium принимал applyConstraints, оставляя noiseSuppression=true. Добавлена
сверка getSettings и fallback restartTrack только для микрофона; browser regression
теперь проверяет фактическое false у RTCRtpSender.track. Комната сохраняется.
При визуальном осмотре viewer видео требовало прокрутки по высоте: область изменена
на flex-контейнер, видео занимает оставшееся место. Добавлена проверка нижней границы
в пределах viewport. Отсоединение remote video больше не удаляет DOM-элемент,
которым владеет React; это сохраняет возможность повторного просмотра.
