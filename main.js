const { app, BrowserWindow, BrowserView, ipcMain, session, webContents, dialog } = require('electron');
const path = require('path');
const url = require('url');

const { classify } = require('./blocklists/match');
const { renderBlockedPage } = require('./blocklists/blockedPage');
const siteLists = require('./siteLists');

// Chromium's setuid chrome-sandbox helper needs to be owned by root, which
// doesn't hold up for an AppImage (it extracts to a fresh FUSE mount point on
// every launch, so there's nothing stable to chown). Disabling the sandbox
// trades away Chromium's OS-level per-renderer isolation -- weaker
// defense-in-depth for a browser that visits untrusted sites -- for the app
// just running anywhere with no setup.
//
// This can only be done via an actual --no-sandbox CLI flag present from the
// process's very first invocation: the sandbox check happens in native code
// before any of this file's JS runs, so neither
// app.commandLine.appendSwitch('no-sandbox'), nor setting
// ELECTRON_DISABLE_SANDBOX in this same process, nor even a
// detect-and-self-relaunch-with-the-flag trick can intervene in time -- all
// were tried and confirmed ineffective (a misconfigured sandbox crashes the
// process before any app code, including a relaunch attempt, gets to run).
// The flag has to come from whatever launches the binary instead: see
// package.json's build.linux.executableArgs (bakes it into the .deb's
// desktop entry) and run-appimage.sh (the AppImage has no such hook, so it
// needs a wrapper) for how the packaged app gets it. `npm start` passes it
// directly on the command line for the same reason.

const TOOLBAR_HEIGHT = 76;
const DEFAULT_URL = 'https://www.google.com';
const WELCOME_PAGE_PATH = path.join(__dirname, 'welcome', 'index.html');
const WELCOME_PAGE_URL = url.pathToFileURL(WELCOME_PAGE_PATH).href;

let mainWindow = null;
const tabs = new Map(); // id -> { view, allowed }
let activeTabId = null;
let nextTabId = 1;

function safeHostname(requestUrl) {
  try {
    return new URL(requestUrl).hostname;
  } catch {
    return null;
  }
}

function showBlockedPage(details, hostname, reason) {
  const wc = webContents.fromId(details.webContentsId);
  if (wc && !wc.isDestroyed()) {
    const html = renderBlockedPage(hostname, reason);
    wc.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
  }
}

// A navigation this app itself triggers (address-bar entry, welcome-page
// search/link clicks) is exempt from the whitelist gate below -- it's a
// direct user action, not "a website requesting another website". Recorded
// right before the matching loadURL() call and consumed the first time a
// matching mainFrame request is observed.
const pendingExplicitNav = new Map(); // webContentsId -> url

function markExplicitNavigation(webContentsId, targetUrl) {
  pendingExplicitNav.set(webContentsId, targetUrl);
}

function consumeExplicitNavigation(details) {
  if (details.resourceType !== 'mainFrame') return false;
  if (pendingExplicitNav.get(details.webContentsId) !== details.url) return false;
  pendingExplicitNav.delete(details.webContentsId);
  return true;
}

// A server-side redirect (fer.hr -> www.fer.unizg.hr) fires a fresh
// onBeforeRequest for the new URL, but webContents.getURL() still reports
// whatever was loaded *before this navigation started* -- the redirecting
// page never committed, so it never became "current". Chromium keeps
// details.id constant across an entire redirect chain, so track each hop's
// resolved hostname under that id instead: the redirecting page itself is
// the correct "who's asking" for where it redirects to.
const mainFrameChainOrigin = new Map(); // details.id -> hostname of the current hop

function getRequestingHostname(details) {
  if (details.resourceType === 'mainFrame') {
    const chainOrigin = mainFrameChainOrigin.get(details.id);
    if (chainOrigin) return chainOrigin;
  }
  const wc = webContents.fromId(details.webContentsId);
  if (!wc || wc.isDestroyed()) return null;
  return safeHostname(wc.getURL());
}

function rememberMainFrameHop(details, hostname) {
  if (details.resourceType === 'mainFrame' && hostname) {
    mainFrameChainOrigin.set(details.id, hostname);
  }
}

function forgetMainFrameChain(details) {
  mainFrameChainOrigin.delete(details.id);
}

// One native confirm dialog per target hostname, deduped so concurrent
// requests for the same host (e.g. several subresources) share one prompt
// instead of stacking duplicates.
const pendingDecisions = new Map(); // hostname -> Promise<boolean>

function requestAccessDecision(requestingHostname, targetHostname) {
  const existing = pendingDecisions.get(targetHostname);
  if (existing) return existing;

  const decision = dialog
    .showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Disallow', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      title: 'Site access request',
      message: `${requestingHostname} is trying to access ${targetHostname}`,
      detail:
        'Allow lets this site be reached from now on (added to your whitelist). ' +
        'Disallow blocks it permanently (added to your blacklist). Either way you ' +
        "won't be asked again for this site.",
    })
    .then(({ response }) => {
      const allowed = response === 1;
      if (allowed) siteLists.addToWhitelist(targetHostname);
      else siteLists.addToBlacklist(targetHostname);
      pendingDecisions.delete(targetHostname);
      return allowed;
    });

  pendingDecisions.set(targetHostname, decision);
  return decision;
}

// Set by the welcome page (via IPC) based on the to-do list: null means no
// restriction (normal whitelist gate applies); an array means ONLY those
// hostnames (and their first-party resources) are reachable, overriding even
// the whitelist/explicit-nav bypass -- otherwise typing any address would
// trivially defeat the point. An EMPTY array is a deliberate total lockdown
// (multiple tasks overdue, none picked yet as the one being worked on) --
// null and [] are meaningfully different, not interchangeable.
let focusModeHosts = null;

function setFocusModeHosts(hostnames) {
  focusModeHosts = hostnames;
}

function isTaskSite(hostname) {
  return !!hostname && focusModeHosts.some((h) => h === hostname || siteLists.isSameSite(h, hostname));
}

function isAllowedInFocusMode(targetHostname, requestingHostname) {
  if (!targetHostname) return false;
  if (isTaskSite(targetHostname)) return true;
  // A page that's ITSELF one of the task's own sites can still reach
  // generally-whitelisted content (fonts, CDNs, captchas, etc.) -- but a
  // fresh top-level navigation to some unrelated whitelisted site (e.g.
  // clicking a different link on the welcome page) isn't "content access by
  // the task's site" and stays blocked, even if that destination happens to
  // be on the whitelist for unrelated reasons.
  return isTaskSite(requestingHostname) && siteLists.isWhitelisted(targetHostname);
}

// Ad + social blocking is wired into every session partition and is not
// conditioned on anything user-configurable: there is no IPC channel or UI
// affordance that disables it. On top of that, 'blocked'/'allowed' partitions
// (normal browsing tabs, not the welcome page) enforce a default-deny
// whitelist for cross-site requests: allowed if first-party, explicitly
// whitelisted, or approved via the popup (only ever offered when the
// requesting page is itself one of the user's own curated links -- a leaf
// site that only got whitelisted as someone else's dependency can't cascade
// further, per the "not in any link group" rule). On top of THAT, an active
// overdue to-do task narrows things further to just its own sites.
function installNetworkBlocking(sess, { enforceWhitelist }) {
  function allow(details, targetHostname, callback) {
    rememberMainFrameHop(details, targetHostname);
    callback({ cancel: false });
  }

  sess.webRequest.onBeforeRequest((details, callback) => {
    const match = classify(details.url);
    if (match) {
      if (match.kind === 'social' && details.resourceType === 'mainFrame') {
        callback({ cancel: true });
        // Chromium refuses to redirectURL an https request straight to a
        // file:// target (ERR_UNSAFE_REDIRECT), so cancel the navigation and
        // separately point that tab's webContents at the blocked page instead.
        // The hostname is baked into the HTML in the main process (not filled
        // in by client-side JS), since default tabs run with javascript:false.
        showBlockedPage(details, match.hostname, 'social');
        return;
      }
      return callback({ cancel: true });
    }

    const targetHostname = safeHostname(details.url);

    // Non-http(s) URLs (data:, blob:, about:...) have no hostname and are
    // never "sites" the gating below cares about -- most importantly, this
    // is what our own blocked-page interstitial loads as a data: URL, and
    // without this exemption a mainFrame block during focus mode would
    // reject that load too (no hostname => not in the allow-list), triggering
    // showBlockedPage again, which loads another data: URL, forever.
    if (!targetHostname) return allow(details, targetHostname, callback);

    const requestingHostname = getRequestingHostname(details);

    if (enforceWhitelist && focusModeHosts !== null) {
      if (isAllowedInFocusMode(targetHostname, requestingHostname)) return allow(details, targetHostname, callback);
      if (details.resourceType === 'mainFrame') showBlockedPage(details, targetHostname, 'focus-mode');
      return callback({ cancel: true });
    }

    if (!enforceWhitelist) return allow(details, targetHostname, callback);
    if (consumeExplicitNavigation(details)) return allow(details, targetHostname, callback);

    if (requestingHostname && siteLists.isSameSite(requestingHostname, targetHostname)) {
      return allow(details, targetHostname, callback); // first-party resource, no gating needed
    }

    if (siteLists.isBlacklisted(targetHostname)) {
      if (details.resourceType === 'mainFrame') showBlockedPage(details, targetHostname, 'blacklisted');
      return callback({ cancel: true });
    }
    if (siteLists.isWhitelisted(targetHostname)) return allow(details, targetHostname, callback);

    if (requestingHostname && siteLists.isLinkHost(requestingHostname)) {
      requestAccessDecision(requestingHostname, targetHostname).then((allowed) => {
        if (allowed) {
          rememberMainFrameHop(details, targetHostname);
        } else if (details.resourceType === 'mainFrame') {
          showBlockedPage(details, targetHostname, 'blacklisted');
        }
        callback({ cancel: !allowed });
      });
      return;
    }

    // Requesting page isn't one of the user's own links (it's at most a leaf
    // that was itself whitelisted as someone else's dependency) -- no popup,
    // auto-deny.
    if (details.resourceType === 'mainFrame') showBlockedPage(details, targetHostname, 'not-whitelisted');
    callback({ cancel: true });
  });

  sess.webRequest.onCompleted((details) => forgetMainFrameChain(details));
  sess.webRequest.onErrorOccurred((details) => forgetMainFrameChain(details));
}

// Approximates "cookies off": strips the Cookie request header and any
// Set-Cookie response headers for the given session, so nothing is sent or
// stored. Only applied to the 'blocked' (non-opted-in) partition.
function installCookieBlocking(sess) {
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'cookie') delete headers[key];
    }
    callback({ requestHeaders: headers });
  });

  sess.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'set-cookie') delete headers[key];
    }
    callback({ responseHeaders: headers });
  });
}

function getSessionFor(allowed) {
  const partition = allowed ? 'persist:allowed' : 'persist:blocked';
  const sess = session.fromPartition(partition);
  if (!sess._shieldConfigured) {
    installNetworkBlocking(sess, { enforceWhitelist: true });
    if (!allowed) installCookieBlocking(sess);
    sess._shieldConfigured = true;
  }
  return sess;
}

function serializeTabs() {
  return {
    activeTabId,
    tabs: [...tabs.entries()].map(([id, tab]) => ({
      id,
      title: tab.isWelcome ? 'Welcome!' : tab.view.webContents.getTitle() || tab.view.webContents.getURL() || 'New Tab',
      url: tab.isWelcome ? '' : tab.view.webContents.getURL(),
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
      allowed: tab.allowed,
      isWelcome: tab.isWelcome,
      loading: tab.view.webContents.isLoading(),
    })),
  };
}

function broadcastState() {
  if (mainWindow) mainWindow.webContents.send('tabs-state', serializeTabs());
}

function resizeActiveView() {
  const tab = tabs.get(activeTabId);
  if (!tab || !mainWindow) return;
  const [width, height] = mainWindow.getContentSize();
  tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: height - TOOLBAR_HEIGHT });
}

function normalizeInput(input) {
  const trimmed = input.trim();
  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed);
  if (looksLikeUrl) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function createBrowsingView(allowed) {
  const view = new BrowserView({
    webPreferences: {
      javascript: allowed,
      partition: allowed ? 'persist:allowed' : 'persist:blocked',
      contextIsolation: true,
      sandbox: true,
    },
  });
  getSessionFor(allowed); // ensure blocking is wired for this partition
  return view;
}

// The welcome/new-tab page is bundled, local, and fully trusted, so it always
// runs with JavaScript (and its own partition's cookies/localStorage) on --
// independent of the per-tab shield toggle, which only applies once the tab
// navigates to a real website.
function createWelcomeView() {
  return new BrowserView({
    webPreferences: {
      javascript: true,
      partition: 'persist:welcome',
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'welcome', 'preload.js'),
    },
  });
}

function attachViewListeners(view, id) {
  const wc = view.webContents;
  const emit = () => broadcastState();
  wc.on('page-title-updated', emit);
  wc.on('did-navigate', emit);
  wc.on('did-navigate-in-page', emit);
  wc.on('did-start-loading', emit);
  wc.on('did-stop-loading', emit);

  wc.setWindowOpenHandler(({ url: targetUrl }) => {
    createTab(targetUrl);
    return { action: 'deny' };
  });
}

function offerAddLinkToWelcomePages(hostname) {
  for (const tab of tabs.values()) {
    if (tab.isWelcome && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.send('offer-add-link', hostname);
    }
  }
}

// Called for every direct/user-initiated navigation (address bar, welcome
// search, welcome site-link clicks): social/ad destinations are still fully
// blocked, but anything else is auto-whitelisted so it's reachable going
// forward, and -- the first time a genuinely new host is reached this way --
// the welcome page(s) are asked whether to also add it as a link (which is
// what actually grants it "can request further sites" trust).
function handleDirectNavigation(targetUrl) {
  // While focus mode is active, direct navigation doesn't grant new access
  // either (the webRequest gate already blocks it) -- and critically, this
  // side effect must not run regardless, or typing a blocked site's address
  // would whitelist it and offer to add it as a link, defeating the
  // restriction entirely (edit mode is locked out during focus mode too, so
  // this would otherwise be the only way to add a link while it's active).
  if (focusModeHosts !== null) return;
  const hostname = safeHostname(targetUrl);
  if (!hostname) return;
  if (classify(targetUrl)) return; // still fully blocked; no override
  const alreadyWhitelisted = siteLists.isWhitelisted(hostname);
  siteLists.addToWhitelist(hostname);
  if (!alreadyWhitelisted) offerAddLinkToWelcomePages(hostname);
}

// Search submissions and site-shortcut clicks on the welcome page open the
// target in a new tab, leaving the welcome page itself in place so it stays
// reachable. These are opened with JS/cookies already enabled: it's a
// deliberate click from a trusted, user-curated page (not an arbitrary link
// on some other website), and many sites (Google search included) just show
// an "enable JavaScript" interstitial instead of working at all otherwise.
// (Address-bar navigation on a welcome tab is handled separately, via
// leaveWelcomePage, and still defaults to blocked -- see the 'navigate' IPC
// handler below.)
function attachWelcomeNavigationGuard(view) {
  view.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl === WELCOME_PAGE_URL || targetUrl.startsWith('file://')) return;
    event.preventDefault();
    handleDirectNavigation(targetUrl);
    createTab(targetUrl, true, true);
  });
}

function leaveWelcomePage(id, targetUrl) {
  const tab = tabs.get(id);
  if (!tab) return;
  const wasActive = activeTabId === id;

  if (wasActive && mainWindow) mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();

  const view = createBrowsingView(false);
  attachViewListeners(view, id);
  tabs.set(id, { view, allowed: false, isWelcome: false });
  handleDirectNavigation(targetUrl);
  markExplicitNavigation(view.webContents.id, targetUrl);
  view.webContents.loadURL(targetUrl);

  if (wasActive) switchTab(id);
  else broadcastState();
}

// `explicit` marks this as a direct user action (address bar, welcome-page
// search/link click) rather than something a page requested on its own --
// see handleDirectNavigation/markExplicitNavigation. It's false for e.g.
// target=_blank links opened from within an already-loaded page, which are
// exactly the kind of request the new whitelist gate is meant to catch.
function createTab(initialUrl, allowed = false, explicit = false) {
  const id = nextTabId++;
  const isWelcome = !initialUrl;
  const view = isWelcome ? createWelcomeView() : createBrowsingView(allowed);
  attachViewListeners(view, id);
  if (isWelcome) attachWelcomeNavigationGuard(view);
  tabs.set(id, { view, allowed: isWelcome || allowed, isWelcome });
  if (explicit && !isWelcome) markExplicitNavigation(view.webContents.id, initialUrl);
  view.webContents.loadURL(isWelcome ? WELCOME_PAGE_URL : initialUrl);
  switchTab(id);
  return id;
}

function switchTab(id) {
  const tab = tabs.get(id);
  if (!tab || !mainWindow) return;
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  resizeActiveView();
  broadcastState();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (mainWindow && activeTabId === id) mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      app.quit();
      return;
    }
  }
  broadcastState();
}

function toggleJsCookies(id) {
  const tab = tabs.get(id);
  if (!tab || tab.isWelcome) return; // shield toggle doesn't apply to the trusted welcome page
  const currentUrl = tab.view.webContents.getURL();
  const wasActive = activeTabId === id;
  const newAllowed = !tab.allowed;

  if (wasActive && mainWindow) mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();

  const view = createBrowsingView(newAllowed);
  attachViewListeners(view, id);
  tabs.set(id, { view, allowed: newAllowed, isWelcome: false });
  view.webContents.loadURL(currentUrl || DEFAULT_URL);

  if (wasActive) switchTab(id);
  else broadcastState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  // Every JS/cookies toggle and every welcome-page navigation replaces a
  // tab's BrowserView with a brand-new one (webPreferences are immutable
  // after creation). Electron's internal BrowserView.ownerWindow setter adds
  // a 'closed' listener to the window on each attach with no corresponding
  // removal on detach, so this count climbs by one per view swap over a long
  // session -- that's an Electron bookkeeping quirk, not a leak in our own
  // teardown (webContents.destroy() still frees the actual render process).
  // Raise the cap so normal use doesn't spam MaxListenersExceededWarning.
  mainWindow.setMaxListeners(0);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // On Linux, 'resize' can fire before the window manager finishes the
  // maximize/unmaximize transition, so getContentSize() reads the old size.
  // Deferring with setImmediate re-reads it after the transition settles.
  const deferredResize = () => setImmediate(resizeActiveView);
  mainWindow.on('resize', deferredResize);
  mainWindow.on('maximize', deferredResize);
  mainWindow.on('unmaximize', deferredResize);

  createTab();
}

ipcMain.on('new-tab', (_e, targetUrl) => createTab(targetUrl));
ipcMain.on('close-tab', (_e, id) => closeTab(id));
ipcMain.on('switch-tab', (_e, id) => switchTab(id));
ipcMain.on('navigate', (_e, { id, input }) => {
  const tab = tabs.get(id);
  if (!tab) return;
  const targetUrl = normalizeInput(input);
  // webContents.loadURL() is a programmatic navigation and does not fire
  // 'will-navigate', so the welcome page's navigation guard can't see it --
  // route address-bar navigation through the same swap-away-from-welcome path.
  if (tab.isWelcome) {
    leaveWelcomePage(id, targetUrl);
  } else {
    handleDirectNavigation(targetUrl);
    markExplicitNavigation(tab.view.webContents.id, targetUrl);
    tab.view.webContents.loadURL(targetUrl);
  }
});
ipcMain.on('go-back', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goBack());
ipcMain.on('go-forward', (_e, id) => tabs.get(id)?.view.webContents.navigationHistory.goForward());
ipcMain.on('reload', (_e, id) => tabs.get(id)?.view.webContents.reload());
ipcMain.on('toggle-js-cookies', (_e, id) => toggleJsCookies(id));
ipcMain.handle('get-state', () => serializeTabs());

// Bridge for the welcome page's preload: it owns the "links" UI, but the
// whitelist/blacklist/link-hosts data these read is main-process state
// (needed for the webRequest gate above).
ipcMain.on('sync-link-hosts', (_e, hostnames) => siteLists.setLinkHosts(hostnames));
ipcMain.on('whitelist-host', (_e, hostname) => siteLists.addToWhitelist(hostname));
ipcMain.handle('get-site-lists', () => ({
  whitelist: siteLists.getWhitelist(),
  blacklist: siteLists.getBlacklist(),
}));
ipcMain.on('remove-from-whitelist', (_e, hostname) => siteLists.removeFromWhitelist(hostname));
ipcMain.on('remove-from-blacklist', (_e, hostname) => siteLists.removeFromBlacklist(hostname));
ipcMain.on('set-focus-mode', (_e, hostnames) => setFocusModeHosts(hostnames));

app.whenReady().then(() => {
  siteLists.load(app.getPath('userData'));
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
