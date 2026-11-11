import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type RecorderCommand, type RecorderReply, type VoiceBridgeApi } from '../shared/ipc';

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: VoiceBridgeApi = {
  onOverlay: (cb) => on(IPC.overlay, cb),
  onFailures: (cb) => on(IPC.failures, cb),
  onLevel: (cb) => on(IPC.level, cb),
  onLiveText: (cb) => on(IPC.liveText, cb),
  selectSession: (id) => ipcRenderer.send(IPC.selectSession, id),
  resolveFailure: (id, action) => ipcRenderer.send(IPC.resolveFailure, id, action),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text),
  revealSession: (id) => ipcRenderer.send(IPC.revealSession, id),
  setOverlaySize: (width, height, anchor, above = 0) =>
    ipcRenderer.send(IPC.overlaySize, width, height, anchor, above),
  ready: () => ipcRenderer.send(IPC.ready),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (config) => ipcRenderer.invoke(IPC.saveSettings, config),
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke(IPC.setOpenAtLogin, enabled),
  captureHotkey: () => ipcRenderer.invoke(IPC.captureHotkey),
  testConnection: () => ipcRenderer.invoke(IPC.testConnection),
  clearHistory: () => ipcRenderer.invoke(IPC.clearHistory),
  getRemote: () => ipcRenderer.invoke(IPC.getRemote),
  newPairingCode: () => ipcRenderer.invoke(IPC.newPairingCode),
  removeDevice: (id) => ipcRenderer.invoke(IPC.removeDevice, id),
  onDeskOpen: (cb) => on(IPC.deskOpen, cb),
  setDeskLayout: (layout) => ipcRenderer.send(IPC.deskLayout, layout),
  getDesk: () => ipcRenderer.invoke(IPC.getDesk),
  onDesk: (cb) => on(IPC.desk, cb),
  pinSession: (id) => ipcRenderer.send(IPC.pinSession, id),
  launchSession: (folder) => ipcRenderer.invoke(IPC.launchSession, folder),
};

/** Only for the hidden recorder window. */
const recorder = {
  onCommand: (cb: (c: RecorderCommand) => void) => on(IPC.recorderCommand, cb),
  reply: (r: RecorderReply) => ipcRenderer.send(IPC.recorderReply, r),
  level: (level: number) => ipcRenderer.send(IPC.recorderLevel, level),
  pcm: (pcm: Uint8Array) => ipcRenderer.send(IPC.recorderPcm, pcm),
  ready: () => ipcRenderer.send(IPC.recorderReady),
};

contextBridge.exposeInMainWorld('vb', api);
contextBridge.exposeInMainWorld('vbRecorder', recorder);
