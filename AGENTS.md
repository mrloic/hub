# Hub
Русский интерфейс и документация, английские имена в коде. Модульный монолит NestJS,
React/Vite, PostgreSQL/Prisma. Единственный менеджер — npm; фиксировать package-lock.json.

- Не менять систему, SSH, сеть, прокси, DNS; не публиковать сервис и не делать git push.
- Не читать секреты вне проекта. Не логировать пароли, cookies, приглашения.
- Не удалять данные/volumes. Тесты используют отдельный Compose-проект и БД.
- Локальная публикация: 127.0.0.1:8080 и голосовой ICE/TCP 127.0.0.1:7881; PostgreSQL/API/LiveKit API без host ports.
- Права проверяются в API, записи через HTTP, Socket.IO передаёт инвалидации.
- apps/api — backend, apps/web — UI, packages/shared — контракты,
  infra — контейнеры, scripts — команды, docs — решения и инструкции.
- Проверки: npm run lint; npm run typecheck; npm run test:unit;
  npm run build; npm run test:integration; npm run test:e2e.
- Не заявлять заблокированные проверки выполненными. Голос — self-hosted LiveKit; экран через LiveKit, камера вне этапа. Production готовится отдельно; реальные DNS/NAT/firewall/публикация — только USER ACTION.

- apps/desktop — Electron main/preload; переиспользовать apps/web, не копировать UI.
- packages/audio — локальные RNNoise/VAD/PTT; без сторонних PCM-сервисов и Krisp.
- Desktop: npm run desktop:build; installer только Windows: npm run desktop:package.
- Не обновлять production ради desktop-тестов; Windows OS-проверки не подменять Ubuntu unit.
