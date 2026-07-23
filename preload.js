const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  newTab: (url) => ipcRenderer.send('new-tab', url),
  closeTab: (id) => ipcRenderer.send('close-tab', id),
  switchTab: (id) => ipcRenderer.send('switch-tab', id),
  navigate: (id, input) => ipcRenderer.send('navigate', { id, input }),
  goBack: (id) => ipcRenderer.send('go-back', id),
  goForward: (id) => ipcRenderer.send('go-forward', id),
  reload: (id) => ipcRenderer.send('reload', id),
  toggleJsCookies: (id) => ipcRenderer.send('toggle-js-cookies', id),
  getState: () => ipcRenderer.invoke('get-state'),
  onTabsState: (callback) => ipcRenderer.on('tabs-state', (_e, state) => callback(state)),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-maximize-toggle'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onWindowMaximizedState: (callback) => ipcRenderer.on('window-maximized-state', (_e, maximized) => callback(maximized)),
});
