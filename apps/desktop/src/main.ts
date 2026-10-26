import {
  app,
  BrowserWindow,
  session,
  shell,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  Notification,
  globalShortcut,
  desktopCapturer,
  screen,
  powerMonitor,
} from "electron";
import { join, extname } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SettingsStore, normalizeDesktop, closeAction } from "./settings";
import {
  HUB_ORIGIN,
  trusted,
  externalLink,
  localAsset,
  networkAllowed,
} from "./security";
import { Shortcuts } from "./shortcuts";
import type { DesktopEvent } from "../../../packages/shared/src/desktop";
app.setName("Hub");
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("ru.mrloic.hub");
      const store = new SettingsStore(
        join(app.getPath("userData"), "settings-v1.json"),
      );
      let settings = store.read();
      if (process.platform === "win32" && app.isPackaged)
        settings.autostart = app.getLoginItemSettings().openAtLogin;
      let quitting = false;
      const boundsFile = join(app.getPath("userData"), "window.json");
      let bounds: Partial<Electron.Rectangle> = { width: 1200, height: 800 };
      try {
        const saved = JSON.parse(readFileSync(boundsFile, "utf8"));
        if (
          [saved.x, saved.y, saved.width, saved.height].every(
            Number.isFinite,
          ) &&
          saved.width >= 640 &&
          saved.height >= 480 &&
          screen
            .getAllDisplays()
            .some(
              (d) =>
                saved.x < d.workArea.x + d.workArea.width &&
                saved.x + saved.width > d.workArea.x &&
                saved.y < d.workArea.y + d.workArea.height &&
                saved.y + saved.height > d.workArea.y,
            )
        )
          bounds = saved;
      } catch {
        /* First run. */
      }
      const ses = session.fromPartition("persist:hub");
      const root = app.isPackaged
        ? join(process.resourcesPath, "web")
        : join(app.getAppPath(), "../web/dist");
      const csp =
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://rtc.mrloic.ru wss://rtc.mrloic.ru; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
      await ses.protocol.handle("https", async (request) => {
        const url = new URL(request.url);
        if (!networkAllowed(request.url))
          return new Response(null, { status: 403 });
        if (
          url.origin !== HUB_ORIGIN ||
          /^\/(api|socket\.io)(\/|$)/.test(url.pathname)
        )
          return ses.fetch(request, { bypassCustomProtocolHandlers: true });
        if (request.method !== "GET")
          return new Response(null, { status: 405 });
        const file = localAsset(root, url.pathname);
        const asset =
          file && existsSync(file) && extname(file)
            ? file
            : !extname(url.pathname) && !url.pathname.startsWith("/assets/")
              ? join(root, "index.html")
              : null;
        if (!asset) return new Response(null, { status: 404 });
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".wasm": "application/wasm",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        };
        try {
          return new Response(readFileSync(asset), {
            headers: {
              "Content-Type":
                mime[extname(asset)] ?? "application/octet-stream",
              "Content-Security-Policy": csp,
              "X-Content-Type-Options": "nosniff",
              "Permissions-Policy":
                "camera=(), microphone=(self), display-capture=(self)",
            },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      ses.webRequest.onBeforeRequest((details, callback) =>
        callback({
          cancel:
            !networkAllowed(details.url) &&
            !details.url.startsWith("devtools:"),
        }),
      );
      const win = new BrowserWindow({
        ...bounds,
        minWidth: 640,
        minHeight: 480,
        title: "Hub",
        icon: join(app.getAppPath(), "assets/hub.png"),
        show: false,
        webPreferences: {
          session: ses,
          preload: join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
          webviewTag: false,
        },
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Вид",
            submenu: [
              {
                label: "Полный экран",
                role: "togglefullscreen",
                accelerator: "F11",
              },
              { label: "Масштаб по умолчанию", role: "resetZoom" },
              { label: "Увеличить", role: "zoomIn" },
              { label: "Уменьшить", role: "zoomOut" },
            ],
          },
        ]),
      );
      win.setMenuBarVisibility(false);
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (externalLink(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event, url) => {
        if (!trusted(url)) {
          event.preventDefault();
          if (externalLink(url)) void shell.openExternal(url);
        }
      });
      win.webContents.on("will-redirect", (event, url) => {
        if (!trusted(url)) event.preventDefault();
      });
      win.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      const authorized = (
        event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
      ) =>
        event.sender === win.webContents &&
        event.senderFrame === win.webContents.mainFrame &&
        trusted(event.senderFrame.url);
      ses.setPermissionCheckHandler(
        (contents, permission, origin, details) =>
          contents === win.webContents &&
          trusted(origin) &&
          details.mediaType !== "video" &&
          [
            "media",
            "display-capture",
            "speaker-selection",
            "fullscreen",
          ].includes(permission),
      );
      ses.setPermissionRequestHandler(
        (contents, permission, callback, details) =>
          callback(
            contents === win.webContents &&
              trusted(details.requestingUrl) &&
              [
                "media",
                "display-capture",
                "speaker-selection",
                "fullscreen",
              ].includes(permission) &&
              !(
                "mediaTypes" in details && details.mediaTypes?.includes("video")
              ),
          ),
      );
      const emit = (event: DesktopEvent) => {
        if (!win.isDestroyed()) win.webContents.send("hub:event", event);
      };
      let keyDown: ((key: number) => boolean) | undefined;
      if (process.platform === "win32") {
        try {
          const koffi = await import("koffi");
          const lib = koffi.load("user32.dll");
          const getKey = lib.func("short __stdcall GetAsyncKeyState(int vKey)");
          keyDown = (key) => (Number(getKey(key)) & 0x8000) !== 0;
        } catch {
          console.error("Hub: глобальный PTT недоступен.");
        }
      }
      let shortcutError: string | undefined;
      const shortcuts = new Shortcuts(globalShortcut, emit, keyDown);
      try {
        shortcuts.configure(settings);
      } catch {
        shortcutError =
          "Сохранённое сочетание занято или недоступно. Назначьте горячие клавиши повторно.";
        console.error("Hub: сохранённые горячие клавиши недоступны.");
      }
      let voiceConnected = false;
      let audioTesting = false;
      let captureGeneration = 0;
      let capture:
        | {
            sources: Electron.DesktopCapturerSource[];
            callback: (streams: Electron.Streams) => void;
            timer: ReturnType<typeof setTimeout>;
            audio: boolean;
          }
        | undefined;
      const cancelCapture = () => {
        ++captureGeneration;
        emit({ type: "capture-cancel" });
        if (capture) {
          clearTimeout(capture.timer);
          capture.callback({});
          capture = undefined;
        }
      };
      ses.setDisplayMediaRequestHandler(async (request, callback) => {
        if (
          request.frame !== win.webContents.mainFrame ||
          !trusted(request.securityOrigin) ||
          !request.userGesture ||
          !voiceConnected ||
          capture
        ) {
          callback({});
          return;
        }
        const revision = ++captureGeneration;
        try {
          const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 240, height: 150 },
            fetchWindowIcons: false,
          });
          if (revision !== captureGeneration || !voiceConnected) {
            callback({});
            return;
          }
          capture = {
            sources,
            callback,
            audio: request.audioRequested,
            timer: setTimeout(cancelCapture, 60000),
          };
          emit({
            type: "capture",
            sources: sources.map((s) => ({
              id: s.id,
              name: s.name,
              thumbnail: s.thumbnail.toDataURL(),
            })),
            audio: request.audioRequested && process.platform === "win32",
          });
        } catch {
          callback({});
        }
      });
      ipcMain.handle("hub:capture", (event, id: unknown, audio: unknown) => {
        if (!authorized(event) || !capture) return;
        const source =
          typeof id === "string"
            ? capture.sources.find((s) => s.id === id)
            : undefined;
        const pending = capture;
        capture = undefined;
        clearTimeout(pending.timer);
        pending.callback(
          source
            ? {
                video: source,
                ...(audio === true &&
                pending.audio &&
                process.platform === "win32"
                  ? { audio: "loopback" as const }
                  : {}),
              }
            : {},
        );
      });
      ipcMain.handle("hub:settings", (event) => {
        if (!authorized(event)) throw new Error("Запрещено");
        return { ...settings, error: shortcutError };
      });
      ipcMain.handle("hub:settings-save", (event, value: unknown) => {
        if (!authorized(event)) throw new Error("Запрещено");
        const next = normalizeDesktop(value);
        try {
          shortcuts.configure(next);
          if (next.autostart !== settings.autostart) {
            if (process.platform !== "win32" || !app.isPackaged)
              throw new Error(
                "Автозапуск доступен в установленном Windows-приложении.",
              );
            app.setLoginItemSettings({
              openAtLogin: next.autostart,
              path: process.execPath,
            });
          }
          store.save(next);
          settings = next;
          shortcutError = undefined;
          return { settings };
        } catch (error) {
          try {
            shortcuts.configure(settings);
          } catch {
            /* Unavailable binding stays disabled. */
          }
          return {
            settings,
            error:
              error instanceof Error
                ? error.message
                : "Не удалось сохранить настройки.",
          };
        }
      });
      ipcMain.on("hub:voice", (event, value: unknown, testing: unknown) => {
        if (authorized(event) && typeof value === "boolean") {
          voiceConnected = value;
          audioTesting = testing === true;
          shortcuts.voiceActive(value || audioTesting);
          if (!value) cancelCapture();
        }
      });
      let lastNotification = 0;
      ipcMain.on("hub:notify", (event) => {
        if (
          !authorized(event) ||
          !settings.notifications ||
          win.isFocused() ||
          Date.now() - lastNotification < 15000
        )
          return;
        lastNotification = Date.now();
        const notice = new Notification({
          title: "Hub",
          body: "Новое сообщение в открытом текстовом канале",
          silent: true,
        });
        notice.on("click", () => {
          win.show();
          win.focus();
        });
        notice.show();
      });
      const tray = new Tray(
        nativeImage.createFromPath(join(app.getAppPath(), "assets/hub.png")),
      );
      tray.setToolTip("Hub");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: "Открыть Hub",
            click: () => {
              win.show();
              win.focus();
            },
          },
          {
            label: "Выйти из Hub",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("double-click", () => {
        win.show();
        win.focus();
      });
      win.on("close", (event) => {
        try {
          writeFileSync(boundsFile, JSON.stringify(win.getNormalBounds()), {
            mode: 0o600,
          });
        } catch {
          /* Optional window geometry. */
        }
        if (closeAction(quitting, settings.minimizeToTray) === "hide") {
          event.preventDefault();
          win.hide();
        } else {
          quitting = true;
        }
      });
      win.on("closed", () => app.quit());
      app.on("before-quit", () => {
        quitting = true;
        cancelCapture();
        shortcuts.clear();
      });
      app.on("will-quit", () => {
        globalShortcut.unregisterAll();
        tray.destroy();
      });
      powerMonitor.on("suspend", () => shortcuts.voiceActive(false));
      powerMonitor.on("lock-screen", () => shortcuts.voiceActive(false));
      powerMonitor.on("resume", () =>
        shortcuts.voiceActive(voiceConnected || audioTesting),
      );
      powerMonitor.on("unlock-screen", () =>
        shortcuts.voiceActive(voiceConnected || audioTesting),
      );
      win.webContents.on("render-process-gone", () => {
        voiceConnected = false;
        audioTesting = false;
        shortcuts.voiceActive(false);
        cancelCapture();
      });
      win.webContents.on(
        "did-start-navigation",
        (_e, _url, _inPlace, mainFrame) => {
          if (mainFrame) {
            voiceConnected = false;
            audioTesting = false;
            shortcuts.voiceActive(false);
            cancelCapture();
          }
        },
      );
      app.on("second-instance", () => {
        win.show();
        win.focus();
      });
      await win.loadURL(HUB_ORIGIN);
      win.show();
    })
    .catch(() => {
      console.error("Hub: не удалось запустить приложение.");
      app.quit();
    });
