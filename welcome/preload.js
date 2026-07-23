const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('siteListAPI', {
  syncLinkHosts: (hostnames) => ipcRenderer.send('sync-link-hosts', hostnames),
  whitelistHost: (hostname) => ipcRenderer.send('whitelist-host', hostname),
  blacklistHost: (hostname) => ipcRenderer.send('blacklist-host', hostname),
  getLists: () => ipcRenderer.invoke('get-site-lists'),
  isBlockedByDefault: (hostname) => ipcRenderer.invoke('is-blocked-by-default', hostname),
  removeFromWhitelist: (hostname) => ipcRenderer.send('remove-from-whitelist', hostname),
  removeFromBlacklist: (hostname) => ipcRenderer.send('remove-from-blacklist', hostname),
  onOfferAddLink: (callback) => ipcRenderer.on('offer-add-link', (_e, hostname) => callback(hostname)),
  setFocusMode: (hostnames) => ipcRenderer.send('set-focus-mode', hostnames),
});
