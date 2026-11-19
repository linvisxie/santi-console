/**
 * 三体控制台 · 预加载
 * 页面仍是沙箱（contextIsolation + 无 nodeIntegration），
 * 只暴露三个明确的动作：
 *   setOverlayColor —— 标题栏按钮区随主题换色
 *   openExternal    —— 用系统默认浏览器打开外链
 *   revealFile      —— 在资源管理器中定位本地文件
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consoleNative', {
  setOverlayColor: (color, symbolColor) =>
    ipcRenderer.send('console:overlay-color', { color, symbolColor }),
  openExternal: (url) => ipcRenderer.send('console:open-external', String(url)),
  revealFile: (path) => ipcRenderer.send('console:reveal-file', String(path)),
  chooseProjectFolder: () => ipcRenderer.invoke('console:choose-project-folder'),
  captureView: () => ipcRenderer.invoke('console:capture-view'),
  windowCommand: action => ipcRenderer.invoke('console:window-command',action),
  windowState: () => ipcRenderer.invoke('console:window-state'),
  onWindowState: callback => {const handler=(_event,state)=>callback(state);ipcRenderer.on('console:window-state',handler);return ()=>ipcRenderer.removeListener('console:window-state',handler);},
  loginWorkBuddy: () => ipcRenderer.send('console:workbuddy-login'),
});
