# План firewall, без автоматического применения

Три разных уровня:

1. **Listening ports Ubuntu:** SSH 22 для LAN; Docker может показывать docker-proxy
   или правила DNAT вместо обычного процесса в `ss`. Локальный Hub — 127.0.0.1:8080/7881.
2. **Docker published ports production:** 80/TCP, 443/TCP, 7882/UDP на IPv4-интерфейсах хоста (0.0.0.0).
   IPv6 host publication явно не используется.
   PostgreSQL 5432, API 3000, LiveKit 7880/5349 и Caddy health 8080 — только Docker.
   Сеть data internal; SFU 172.30.224.10 в отдельной media-сети.
3. **NAT роутера:** ровно таблица [router-ports.md](router-ports.md). Отсутствие NAT
   не защищает от LAN или отдельно маршрутизируемого IPv6.

## До изменения правил — [USER ACTION]

- Иметь рабочую консоль Hyper-V и второй SSH-сеанс из LAN.
- Зафиксировать существующие правила и backend Docker. Проверить адрес источника
  текущего SSH, интерфейс и подсеть LAN; не угадывать их по одному адресу Ubuntu.
- Подготовить проверяемый откат текущего набора правил и окно обслуживания.
- Сначала явно сохранить ESTABLISHED/RELATED и SSH из согласованной LAN-подсети.
  Проверить новый SSH-сеанс; только затем ограничивать остальное.
- Проверить отсутствие пересечения Docker subnet 172.30.224.0/24 с LAN/VPN/другими
  Docker-сетями. При конфликте согласованно изменить Compose и TURN peer ACL,
  затем повторить TURN-тест. Не менять маршруты Ubuntu ради совпадения с примером.

Безопасная диагностика, Ubuntu:

```bash
sudo ss -lntup
sudo ufw status verbose
sudo iptables -S DOCKER-USER
sudo nft list ruleset
ip -4 route
sudo docker network ls
```

Не применять все команды изменения firewall из случайных инструкций. Docker DNAT
обходит обычные UFW INPUT-правила для published ports. При iptables backend
ограничения forwarded Docker-трафика размещают в DOCKER-USER с учётом уже
выполненного DNAT и conntrack. При native nftables backend цепочки DOCKER-USER нет:
нужна отдельная base chain с корректным hook/priority, без правки цепочек Docker.
Не переключать backend и не отключать Docker iptables автоматически.

План разрешений: внешний вход 80/443 TCP и 7882 UDP, ответы установленных соединений;
исходящие DNS, NTP по существующей системе, HTTPS для ACME/обновлений. Запретить
доступ извне к БД/API/админ-портам; SSH только LAN. Правила IPv6 рассмотреть отдельно.
После применения проверить с LAN и внешней сети, затем после reboot.

Источник: [Docker packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/).
Системные правила этим проектом не применяются.
