# Hub для Windows x64

## Архитектура и требования

Windows 11 x64; Node.js **24.21.0** и npm той же поставки (один package-lock.json).
Приложение Electron 44.4.1, electron-builder 26.15.3, NSIS. Backend и LiveKit
остаются на https://hub.mrloic.ru и wss://rtc.mrloic.ru. Локальный backend не запускается.
Нужны сеть, разрешение микрофона в Windows и доступ к выбранным устройствам.

## Копирование и установка — CMD Windows

Скопируйте репозиторий в отдельную папку Windows, например `C:\Projects\hub`.
Не копируйте `.env*`, `.tools`, `node_modules`, `.runtime`, backups, dist и приватные ключи.
Не нужен git push/публичный репозиторий. Если используете свой Git — clone обычным способом.
Откройте CMD в корне скопированного проекта:

```cmd
node --version
npm --version
npm ci
npm run desktop:install-runtime
npm run desktop:dev
```

`desktop:install-runtime` запускает официальный загрузчик закреплённого Electron;
у Electron 44 runtime устанавливается отдельно. Не задавайте ELECTRON_SKIP_BINARY_DOWNLOAD
в Windows и не используйте случайные зеркала. Загрузчик проверяет upstream checksums.
`desktop:dev` собирает общий frontend и main/preload, затем открывает Hub.
Vite dev server не нужен; после изменения исходников повторите команду.

## Production build и installer — CMD Windows

Перед сборкой завершите dev-приложение через «Выйти из Hub» в меню трея.
Закрытие крестиком при включённом сворачивании в трей оставляет процесс работающим.

```cmd
npm run generate
npm run lint
npm run typecheck
npm run test:unit
npm run desktop:build
npm run desktop:package
```

`generate` создаёт только Prisma client для общей проверки типов, не подключается
к базе и не применяет миграции; server .env для desktop не нужен.

Результат: `apps\desktop\release\Hub-Setup-0.2.0.exe` (x64, NSIS).
Команда package намеренно отклоняется на Ubuntu/ARM64; Wine и Windows VM не требуются.
По умолчанию установка для текущего пользователя; assisted installer также позволяет
выбрать установку для всех пользователей (потребует прав Windows). Выбор каталога, ярлык Start Menu, отдельный
необязательный checkbox ярлыка Desktop. Удаление через настройки приложений Windows.
Данные локальных настроек/сессий не стираются без согласия пользователя при uninstall.

Installer пока **unsigned**. SmartScreen может предупреждать об неизвестном издателе;
Hub не отключает и не обходит защиту. Проверяйте происхождение своей сборки.
Для будущего Authenticode используйте поддерживаемую electron-builder Windows
signing-конфигурацию и сертификат организации/издателя; ключи/пароли только в
защищённой среде сборки, никогда в Git. Покупка сертификата и auto-update вне этапа.

## Использование

Окно Hub сохраняет нормальную геометрию, поддерживает системные minimize/maximize,
F11 fullscreen и tray. «Голос и устройства» доступно в блоке профиля, даже вне звонка.
«Сворачивать в трей» скрывает окно при закрытии; «Выйти из Hub» в tray завершает процесс.
Автозапуск и уведомления выключены по умолчанию, включаются явно в настройках.

PTT/горячие клавиши регистрируются только после сохранения назначения. Пустое поле
удаляет назначение. При конфликте показывается ошибка, старые назначения возвращаются.
Для PTT используется globalShortcut + GetAsyncKeyState через Koffi (MIT), опрос
только назначенной клавиши и модификаторов раз в 20 мс. Ввод не записывается.
Некоторые игры, повышенные права, secure desktop и античит могут запрещать сочетание;
Hub не обходит эти ограничения и не запрашивает запуск от администратора.

Экран выбирается в диалоге Hub из Electron desktopCapturer: экран или окно приложения.
Системный звук opt-in, Windows loopback может включать весь звук, не только выбранное
окно. Камера не разрешена. Удалённые трансляции используют прежний LiveKit viewer.
Глобальная клавиша начала screen share не добавлена: выбор источника требует явного
действия и UI, а web getDisplayMedia требует user activation.

## Хранение, логи и диагностика

`%APPDATA%\Hub`: settings-v1.json, window.json и Chromium session partition.
Voice settings v2 находятся в localStorage той же partition. Пароли не сохраняются
приложением; авторизация — существующая HttpOnly-cookie. Произвольного файлового API
в renderer нет. Отдельных токенов в settings JSON нет, поэтому safeStorage не требуется.
Не публикуйте папку профиля: она содержит действующие browser sessions.

Безопасные сообщения main выводятся в stdout/stderr запуска из CMD; request bodies,
cookies, токены и PCM не логируются. Для диагностики dev можно открыть Developer Tools
через Electron API при локальной разработке, но production UI не включает debug controls.
При недоступной сети показываются прежние ошибки Hub; не отключайте проверку TLS.
Если окно вне экрана — завершите Hub и переименуйте только window.json.
Если микрофон не виден — разрешите доступ приложениям в Windows и нажмите проверку
микрофона; при исчезновении устройства Hub выбирает Default.

## Обязательная проверка на Windows

Установка/удаление/оба ярлыка; вход и сохранение cookie после restart; tray/автозапуск
только после согласия; два аккаунта/чат/голос; input/output hotplug; RNNoise/Standard;
PTT foreground/background/игра + отпускание и lock/unlock; громкость одного участника/deafen;
уведомление о новом сообщении в открытом канале при неактивном окне;
экран/окно/loopback, остановка браузером/Hub/logout. Windows installer и эти OS-сценарии
невозможно подтвердить сборкой TypeScript на Ubuntu. Результаты: desktop-checks.md.

## Источники API

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
- [Session: protocol, permissions, display capture](https://www.electronjs.org/docs/latest/api/session).
- [DesktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer).
- [GlobalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut): событие
  активации не заменяет key-up; отпускание проверяется отдельно.
- [Win32 GetAsyncKeyState](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate).
- [NSIS electron-builder](https://www.electron.build/nsis/).

Для проверки пары используйте desktop с аккаунтом A и браузер инкогнито/второй ПК
с аккаунтом B. Один и тот же аккаунт не держит два параллельных голосовых подключения.
В наушниках сравните Standard/RNNoise, затем проверьте PTT и отпускание в фоне,
выберите другой output, установите громкость B в 0%, переподключите B и убедитесь,
что значение сохранилось. Проверьте screen/window capture отдельно без звука и с loopback.
