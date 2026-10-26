import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAPI,
  DesktopEvent,
} from "../../../packages/shared/src/desktop";
const api: DesktopAPI = {
  getSettings: () => ipcRenderer.invoke("hub:settings"),
  saveSettings: (value) => ipcRenderer.invoke("hub:settings-save", value),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: DesktopEvent) =>
      callback(value);
    ipcRenderer.on("hub:event", listener);
    return () => ipcRenderer.removeListener("hub:event", listener);
  },
  selectCapture: (id, audio) => ipcRenderer.invoke("hub:capture", id, audio),
  notifyMessage: () => ipcRenderer.send("hub:notify"),
  voiceActive: (active, testing = false) =>
    ipcRenderer.send("hub:voice", active, testing),
};
contextBridge.exposeInMainWorld("hubDesktop", api);
