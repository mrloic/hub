# Проброс портов на роутере

[USER ACTION] Настроить Virtual Servers / Port Forwarding вручную.
Названия меню зависят от версии прошивки. Ubuntu: **<UBUNTU_LAN_IP>**, DHCP reservation сохраняется.

| Protocol | External port | Internal IP | Internal port | Service | Purpose | Required/Optional |
|---|---:|---|---:|---|---|---|
| TCP | 80 | <UBUNTU_LAN_IP> | 80 | Caddy | ACME HTTP-01, перенаправление на HTTPS | Required |
| TCP | 443 | <UBUNTU_LAN_IP> | 443 | Caddy | Hub HTTPS/WSS, RTC WSS, TURN/TLS по SNI | Required |
| UDP | 7882 | <UBUNTU_LAN_IP> | 7882 | LiveKit | Один UDP mux для WebRTC | Required для прямого UDP |

Это весь набор выбранной конфигурации. TURN/TLS на 443 обеспечивает обход блокировки UDP.
**Не добавлять** 7880, 7881, 5349, 3478, диапазон 30000–30199, 5432, 6379,
2375/2376, 2019, 22, UDP 443. TURN relay-порты работают внутри контейнера SFU;
его внутренний кандидат используется TURN, внешний кандидат — прямыми клиентами.
Встроенный TURN разрешает peer только собственного SFU.

Не включать DMZ, UPnP, WAN-управление роутером. Не пробрасывать SSH.
Не менять порт снаружи относительно таблицы. Проверять с мобильного интернета:
доступ из LAN по внешнему адресу может зависеть от NAT loopback роутера.
Не открывать IPv6 автоматически; AAAA в этом этапе не используется.

Основание: [LiveKit ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
[параметры v1.13.7](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml).
