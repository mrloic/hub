# Проверки подготовки production — 2026-09-16

Публичный Compose **не запускался**. DNS/NAT/firewall/SSH/системная безопасность
не менялись, ACME не вызывался. Текущий локальный Hub остался работающим.
Результаты относятся к коду и изолированному Docker-окружению.

| Проверка | Результат |
|---|---|
| `npm run lint` | успешно |
| `npm run typecheck` | успешно |
| `npm run test:unit` | 8 успешно, включая доверенный proxy IP и TURN peer ACL |
| `npm run build` | успешно; также Docker api/web и отдельный web-production |
| `npm run test:integration` через scripts/test.sh | 13 успешно с настоящей PostgreSQL/LiveKit |
| Production voice integration | 1 успешно: Secure/HttpOnly/Strict, bearer RTC, минимальные grants, отзыв/подмена/Origin/CSRF |
| `npm run test:e2e` через scripts/test.sh | 3 успешно до restart, 1 успешно после restart; 4 уникальных сценария |
| Compose config local/test/production | успешно, секреты в вывод не включались |
| Caddy production validate | успешно с сетью отключённой, без ACME |
| Healthchecks PostgreSQL/API/LiveKit/Caddy | успешно в изолированных тестах; локальный экземпляр healthy |
| Frontend bundle | проверены реальные значения секретов проекта, не найдены |
| Генератор production env | повторный запуск сохраняет существующий файл/секреты; placeholder и private IP отвергаются |
| Backup/restore | дамп локальной БД восстановлен в отдельный hub-restore-production-check; User/Message counts совпали |

Дополнительно успешно:

- `scripts/test-turn.sh`: один полный голосовой e2e, policy=relay, выбранная ICE-пара,
  настоящий звук и reconnect/kick/delete/logout. Клиент и SFU разделены Docker-сетями,
  прямой маршрут проверен как недоступный; TURN проходит через PROXY v2. В NAT-схеме
  производный кандидат может обозначаться prflx — это учтено проверкой изоляции.
- `scripts/test-edge.sh`: TLS/SNI трёх доменов с явно доверенным **тестовым** CA,
  API JSON/SPA/asset 404/RTC allowlist, TURN binding через TLS+PROXY v2,
  анонимный TURN Allocate отвергнут кодом 401. Проверка TLS не отключалась.
- Production Caddy запускается как uid 1000, /data и /config доступны для записи;
  пути XDG явно направлены в постоянные volumes.

При проверках исправлены: отключённые клиентом ICE-серверы, доверие к proxy IP,
production session-aware RTC gateway, расположение Caddy storage, пересечение
динамических/статических Docker IP и ложноположительная проверка TURN по одному
наличию звука. Окончательный forced-relay тест не допускает прямого пути к SFU.

## Ограничения

- Публичные сертификаты, внешние DNS/NAT, голос из двух независимых сетей, Firefox
  во внешней сети и TURN/TLS через настоящий роутер — **не проверены**, требуют USER ACTION.
- Ubuntu и Windows/Hyper-V не перезагружались; проверен restart тестовых контейнеров.
- Нагрузка, DoS-устойчивость и определённое число одновременных пользователей не измерялись.
- Нет email/recovery; требования перед широким публичным доступом остаются в security.md.
- Vite сообщает о большом JS chunk и аннотациях зависимости Zod; сборка успешна.
- Тестовый CA используется только изолированным TLS-тестом, не production и не системой.
- Test volumes и restore volume сохранены. Рабочая БД не очищалась и не заменялась.

Локальные технические журналы без значений секретов: `.runtime/checks/` (игнорируется Git).
Повторение: [testing.md](testing.md); действия владельца: [public-deployment.md](public-deployment.md).

## Проверенные первичные источники

- [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/)
- [LiveKit ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
- [Параметры v1.13.7](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml)
- [Реализация встроенного TURN v1.13.7](https://github.com/livekit/livekit/blob/v1.13.7/pkg/service/turn.go)
- [Caddy L4: listener wrappers и объединение приложений](https://github.com/mholt/caddy-l4/blob/master/docs/examples/combining_apps.md)
- [Docker packet filtering / UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
