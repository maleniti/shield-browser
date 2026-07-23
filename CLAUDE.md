# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm install               # install deps
npm start                 # run the app (electron . --no-sandbox)
npm run dist              # build AppImage + .deb into dist/ (electron-builder)
```

Tests are plain Node scripts (`node:assert`), one file per module, run directly — there is no test runner/framework:

```
node blocklists/match.test.js
node siteLists.test.js
node welcome/recurrence.test.js
node --check main.js        # syntax-check main.js after editing it
```

Run all three test files plus the syntax check before considering a change to `main.js`, `siteLists.js`, `blocklists/match.js`, or `welcome/recurrence.js` complete — there's no CI wired up, this is the whole verification suite.

`npm start` passes `--no-sandbox` directly because Chromium's setuid sandbox helper needs root ownership that a dev checkout doesn't set up. Packaged builds bake the same flag in differently: `.deb` via `package.json`'s `build.linux.executableArgs` (ends up in the desktop entry's `Exec=` line), and the AppImage via the `run-appimage.sh` wrapper script (AppImages have no desktop-entry hook, and the sandbox helper extracts to a fresh temp path every launch so it can't be `chown`/`chmod`'d once and forgotten).

## Architecture

Single-user Electron browser (main process in `main.js`, ~580 lines, no framework) built around one idea: **every tab's network traffic goes through a `webRequest.onBeforeRequest` gate that decides allow/block per-request**, layered as (checked in this order, each layer overriding the ones after it):

1. **Ad/social blocklists** (`blocklists/ads.js`, `blocklists/social.js`, matched via `blocklists/match.js`) — always active, on every partition, not user-configurable. Social hits get an interstitial (`blocklists/blockedPage.js`); ad hits are silently cancelled.
2. **Focus mode** (`focusModeHosts` in `main.js`) — when a to-do task is overdue, narrows *everything* down to just that task's linked site groups, overriding the whitelist below entirely (`null` = no restriction, `[]` = total lockdown pending task selection — these are not interchangeable).
3. **Whitelist/blacklist** (`siteLists.js`, persisted to `site-lists.json` in `app.getPath('userData')`) — default-deny for any site not on the whitelist. Direct user navigation (address bar, welcome-page search/link clicks) auto-whitelists and bypasses this gate (`markExplicitNavigation`/`consumeExplicitNavigation`); a page's own subresources/redirects don't. A site only gains "link host" status (permission to have *its* outbound requests prompt the user) by being explicitly added as a welcome-page shortcut — being whitelisted as someone else's dependency isn't enough (leaf sites can't cascade further). The prompt itself is a native `dialog.showMessageBox`, deduped per target hostname (`pendingDecisions`).

Each tab is a `BrowserView` with immutable `webPreferences` — toggling the per-tab JS/cookies shield (`toggleJsCookies`) or leaving the welcome page (`leaveWelcomePage`) means destroying the view and creating a new one on a different session partition (`persist:blocked` vs `persist:allowed`), not mutating the existing one. Cookie blocking (`installCookieBlocking`) is done by stripping `Cookie`/`Set-Cookie` headers on the `blocked` partition rather than disabling storage.

`main.js` tracks per-request "who's asking" via `getRequestingHostname`, which needs `mainFrameChainOrigin` to handle server-side redirects correctly: Chromium keeps `details.id` constant across a redirect chain, but `webContents.getURL()` still reports the pre-redirect URL until the new page commits, so each hop's hostname is tracked against `details.id` instead.

**Process split:**
- `main.js` — all browsing/tab logic, network gating, site-list state.
- `preload.js` → `renderer/` — the toolbar/tabstrip chrome UI (`window.browserAPI`).
- `welcome/preload.js` → `welcome/` — the new-tab/welcome page (`window.siteListAPI`), which owns the UI for site groups, whitelist/blacklist management, and the to-do list. It's the only page that always runs with JS/cookies on (bundled and trusted, not a website), independent of the shield toggle.
- `welcome/recurrence.js` — pure functions (no DOM/localStorage) for to-do recurrence/overdue math, dual-loaded as a Node module (for `recurrence.test.js`) and via `<script>` as `window.Recurrence` in the welcome page.

IPC is split into two bridges for this reason: `browserAPI` (tab lifecycle) talks to `main.js` directly; `siteListAPI` lets the welcome page's UI read/write whitelist/blacklist/link-host/focus-mode state that actually lives in `main.js` (needed there since the `webRequest` gate runs in the main process).

Everything blocked shows the same in-app interstitial (`blocklists/blockedPage.js`) rendered as a `data:` URL loaded via `wc.loadURL` — necessary because Chromium refuses `redirectURL` from `https:` to `file:` (`ERR_UNSAFE_REDIRECT`), and `data:`/`blob:`/`about:` URLs are explicitly exempted from the whitelist gate (they have no hostname, and without the exemption the interstitial's own load would trigger another block, looping forever).
