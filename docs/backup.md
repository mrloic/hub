# Резервное копирование PostgreSQL

Все команды — **Ubuntu, корень репозитория**. Backup содержит личные данные,
хеши паролей, сессии и приглашения. Хранить с ограниченным доступом, шифровать
при переносе и копировать на независимый носитель. Дамп не заменяет сохранение
`.env` отдельно в защищённом месте. В Git/build context они исключены.

## Создать дамп без остановки

```bash
umask 077
mkdir -p backups
backup_file="backups/hub-$(date -u +%Y%m%dT%H%M%S%N).dump"
sudo docker compose exec -T db pg_dump -U hub -d hub -Fc > "$backup_file"
test -s "$backup_file"
```

Проверить exit code pg_dump; неполный файл не считать backup. Уникальное имя
не перезаписывает предыдущие. Настроить расписание/retention отдельно, не удалять
старые backup автоматически до проверки политики.

## Проверить восстановление отдельно

Ни одна из следующих команд не обращается к рабочей БД Hub.
Подготовьте `backups/restore.env` с отдельным случайным `RESTORE_PASSWORD`
(минимум 32 случайных байта, например генератором менеджера паролей), права 0600.
Не выводите значение в терминал/отчёт.

```bash
chmod 600 backups/restore.env
sudo docker compose --env-file backups/restore.env -f infra/compose.restore.yaml up -d --wait db
sudo docker compose --env-file backups/restore.env -f infra/compose.restore.yaml exec -T db pg_restore --exit-on-error --no-owner --no-privileges -U hub_restore -d hub_restore < "$backup_file"
sudo docker compose --env-file backups/restore.env -f infra/compose.restore.yaml exec -T db psql -U hub_restore -d hub_restore -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM "Message";'
sudo docker compose --env-file backups/restore.env -f infra/compose.restore.yaml stop
```

Должен использоваться **пустой** restore volume/экземпляр. Повторное восстановление
в непустую БД завершится ошибкой вместо удаления данных: не добавлять `--clean`
или `--if-exists`. Для следующей проверки создайте новый Compose project через
`-p hub-restore-YYYYMMDD` во **всех** командах. Volumes не удаляются автоматически.
Сравните число записей и выбранные данные с исходным снимком. Перед возвратом
в production нужны отдельное согласование, окно обслуживания и проверка миграций.

Фактическую дату и результат проверки восстановления фиксировать в журнале.
Текущий набор автоматических тестов проверяет сохранность при restart, а не backup/restore.

## Удобная команда

Ubuntu, корень репозитория:

```bash
sudo bash scripts/backup.sh local
# После переключения:
sudo bash scripts/backup.sh production
```

Скрипт создаёт уникальный custom-format dump с umask 077, переименовывает `.partial`
только после успешного pg_dump, не меняет БД и не чистит прошлые копии.
Не включает .env, системные роли, Docker metadata или приватные ключи.
Данные аккаунтов/сессий в дампе остаются чувствительными. При sudo файл принадлежит
root; для проверки восстановления читать его через `sudo cat`, направляя сразу в pg_restore:

```bash
sudo cat "$backup_file" | sudo docker compose --env-file backups/restore.env -f infra/compose.restore.yaml exec -T db pg_restore --exit-on-error --no-owner --no-privileges -U hub_restore -d hub_restore
```

Проверка подготовки production 2026-09-16: создан дамп локального Hub,
восстановлен с `--exit-on-error` в **hub-restore-production-check**, отдельный volume,
сверены количества User/Message. Restore-контейнер остановлен, volume сохранён.
Рабочая база не восстанавливалась и не очищалась. Перед каждым обновлением нужен
новый backup; текущая проверка не заменяет регулярное расписание и независимый носитель.
