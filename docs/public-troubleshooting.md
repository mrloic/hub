# Диагностика публичного Hub

Ubuntu, корень проекта. Выполнять после ручного запуска production.
Секреты не выводить: не использовать `docker inspect` целиком, `compose config`
без `--quiet`, `env`, debug-логи, копирование WebSocket URL с access_token.
Логи ниже настроены без request/cookie/token, но перед передачей всё равно проверить.

```bash
sudo docker compose --env-file .env.production -f compose.production.yaml ps
sudo docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 web
sudo docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 api
sudo docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 livekit
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>console.log(r.status))"
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T livekit wget -q --spider http://127.0.0.1:7880/
sudo docker compose --env-file .env.production -f compose.production.yaml exec -T web wget -q --spider http://127.0.0.1:8080/healthz
sudo ss -lntup
getent ahostsv4 hub.mrloic.ru
getent ahostsv4 rtc.mrloic.ru
getent ahostsv4 turn.mrloic.ru
```

Внешняя проверка (клиент с OpenSSL/curl, вне домашней сети):

```bash
curl --fail --show-error --silent https://hub.mrloic.ru/api/health
openssl s_client -connect hub.mrloic.ru:443 -servername hub.mrloic.ru -verify_hostname hub.mrloic.ru -verify_return_error </dev/null
openssl s_client -connect rtc.mrloic.ru:443 -servername rtc.mrloic.ru -verify_hostname rtc.mrloic.ru -verify_return_error </dev/null
openssl s_client -connect turn.mrloic.ru:443 -servername turn.mrloic.ru -verify_hostname turn.mrloic.ru -verify_return_error </dev/null
```

TLS TURN проверяет сертификат, не успешный relay. После handshake TURN может ждать
STUN-пакет: остановить Ctrl+C. Не использовать curl -k. В среде с dev-прокси явно
убедиться, какой маршрут тестируется; локальные запросы выполнять с `--noproxy '*'`.
Не менять существующие настройки прокси ради диагностики.

## Сайт не открывается

Проверить A-записи, отсутствие ошибочной AAAA, питание Windows/VM, DHCP IP, сервисы,
точные NAT-правила и firewall Docker. Проверять с внешней сети. LAN-доступ по
публичному имени может не работать из-за отсутствия hairpin NAT. Не включать DMZ.

## HTTPS не получает сертификат

DNS должен уже указывать на сервер; внешний TCP 80 должен доходить до Caddy.
Проверить CAA, часы сервера, исходящий HTTPS/DNS и ACME ошибки web. Порт 443 не занят
управлением роутером. Не удалять caddy-data и не перезапускать в цикле, расходуя лимиты.
При ошибках остановить публикацию и исправить причину; self-signed не заменяет ACME.

## Socket.IO переподключается

DevTools → WS: hub.mrloic.ru/socket.io, ответ 101; не rtc.mrloic.ru.
Проверить cookie/срок сессии, точный Origin https://hub.mrloic.ru, время сервера,
Caddy upstream api:3000 и здоровье БД. Не разрешать wildcard Origin ради исправления.
Для проверки отрицательного сценария запрос без сессии/с чужим Origin должен
отвергаться. Не копировать авторизованные handshake headers в отчёты.

## Сайт работает, голос нет

Проверить VOICE_ENABLED, LK health, RTC WSS 101 в браузере, сертификат rtc,
микрофон HTTPS и права ОС. /twirp снаружи намеренно 404. Voice JWT выдаётся только
через Hub /api/voice/join; произвольный room не допускается. Ошибка 403 после kick
или logout ожидаема. При смене настроек перезапустить API и LiveKit согласованно.

## Голос работает только в LAN / UDP не проходит

Проверить локальное значение PUBLIC_IPV4 и повторный render-production.mjs,
NAT **UDP** 7882 → <UBUNTU_LAN_IP>:7882. Не путать с TCP.
В `chrome://webrtc-internals` или `about:webrtc` смотреть выбранную candidate pair,
состояние ICE, bytesSent/Received. Не открывать диапазон портов наугад.
TURN может использовать внутренний SFU-кандидат 172.30.224.10 — это штатный путь,
он не требует маршрута к Docker из клиентской сети.

## TURN не используется

При работающем прямом UDP это нормально. Для проверки нужен выбранный **relay**,
а не просто существующий TURN-кандидат. Использовать сеть с заблокированным UDP
или изолированный forced-relay тест. Проверить TLS/SNI turn.mrloic.ru:443,
Caddy L4 → livekit:5349 с PROXY v2 от 172.30.224.2, временные TURN credentials, совпадение ключей API/LK,
лимит 4 allocations на участника и peer ACL. 5349 не публиковать. Не отключать
аутентификацию TURN и не расширять peer ACL на всю LAN/Internet.
Внешние Firefox/Chromium и TURN/TLS пока требуют ручной проверки.

## Микрофон работает только у одного

Проверить mute/deafen у обоих, разрешение микрофона сайта/Windows, выбранное устройство
в браузере, отсутствие монопольного захвата другим приложением, громкость вывода.
Сравнить audio outbound/inbound bytes: отсутствие исходящих байтов — захват/публикация;
есть исходящие, нет входящих — ICE/подписка/сеть; входящие растут, звука нет — вывод/autoplay/deafen.
Индикатор речи не доказывает слышимость. Не выдавать камеру или display-capture.


В выбранной NAT-схеме embedded TURN relay может дать выбранный производный `prflx`
из-за внешнего node_ip и внутреннего пути до SFU. Сам `prflx` ничего не доказывает:
проверять с заблокированным прямым media UDP либо forced-relay сценарием,
где Docker-сети запрещают клиенту прямой доступ к SFU. Все media-соединения по
прямому TCP отключены; при запрете UDP работающий звук должен идти через TURN/TLS.
