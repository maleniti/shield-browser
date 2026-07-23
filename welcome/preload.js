const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('siteListAPI', {
  syncLinkHosts: (hostnames) => ipcRenderer.send('sync-link-hosts', hostnames),
  whitelistHost: (hostname) => ipcRenderer.send('whitelist-host', hostname),
  getLists: () => ipcRenderer.invoke('get-site-lists'),
  removeFromWhitelist: (hostname) => ipcRenderer.send('remove-from-whitelist', hostname),
  removeFromBlacklist: (hostname) => ipcRenderer.send('remove-from-blacklist', hostname),
  onOfferAddLink: (callback) => ipcRenderer.on('offer-add-link', (_e, hostname) => callback(hostname)),
  setFocusMode: (hostnames) => ipcRenderer.send('set-focus-mode', hostnames),
});
