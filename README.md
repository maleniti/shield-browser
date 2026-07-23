# Shield Browser

A minimal Chromium-based browser (built on Electron) for a single user. It
always blocks ads and social media — there is no setting to turn that off —
blocks JavaScript and cookies by default (with a per-tab opt-in), and
defaults to blocking any site that isn't explicitly whitelisted (see "Site
whitelist & blacklist" below).

## Setup

```
npm install
```

## Usage

```
npm start
```

Runs with `--no-sandbox` (Chromium's setuid sandbox helper needs root
ownership to work at all, which this dev workflow doesn't set up). See
"Building & installing (Linux)" below for packaged builds, where the sandbox
flag is baked in instead.

- **Tabs** — click `+` for a new tab, click a tab to switch, click `×` to close.
- **Welcome / new-tab page** — every new tab (and the browser on startup)
  opens a built-in page with a search bar (DuckDuckGo by default, changeable
  in the menu) and your own groups of site shortcuts, shown in a 2×2 grid per
  group. Site/group editing (add, rename, delete) is hidden until you turn on
  "Edit mode" in the hamburger menu — click a group title to rename it
  in-place, use each group's trash icon to delete it, and each site tile's ×
  to remove just that site (armed on first click, confirmed on the second).
  Groups are saved to that page's local storage and persist across restarts.
  This page always runs with JavaScript and cookies on (it's bundled with the
  app, not a website) — clicking a shortcut or searching opens a new tab with
  JavaScript/cookies blocked by default, same as typing a URL.
- **Address bar** — type a URL or a search term and press Enter.
- **Back / forward / reload** — the arrow and refresh buttons in the toolbar.
- **Shield button** (top right of the toolbar) — each tab loads with
  JavaScript and cookies blocked by default. Click the shield to opt that tab
  in (reloads the current page with JavaScript enabled and cookies allowed);
  click again to go back to blocked. This choice is per-tab and isn't
  remembered across restarts — open a new tab to get the blocked default again.
  (Disabled on the welcome page, since that page always has JS/cookies on.)

## What's always blocked

- **Social media** — navigating to a domain in `blocklists/social.js`
  (Facebook, Instagram, X/Twitter, TikTok, LinkedIn, Reddit, etc.) shows a
  blocked-page interstitial instead of loading the site.
- **Ads/trackers** — requests to domains in `blocklists/ads.js` (Google/Amazon
  ad networks, Criteo, Taboola, common analytics/tracking services, etc.) are
  cancelled at the network level, on every tab, regardless of the JS/cookies
  toggle.

Neither list is exposed in the UI. The only way to change what's blocked is
editing those two files and restarting the app.

## Site whitelist & blacklist

On top of the ad/social blocking above, every other site is blocked by
default unless it's on your whitelist:

- **Typing a URL or searching** always reaches its destination (unless it's
  social/ad-blocked) and auto-whitelists that site so it's reachable going
  forward. The first time this happens for a brand-new site, the welcome
  page asks whether to also add it as one of your links (and to which
  group) — Skip just leaves it whitelisted without adding a shortcut.
- **Adding or editing a site link** in edit mode whitelists it immediately
  and — uniquely — makes it a "link host": a site you've explicitly
  curated, trusted enough that pages it links to can prompt you before
  being blocked (see next point).
- **A page requesting another site** (a link you click on that page, an
  embedded iframe/script, a redirect) is only ever allowed to prompt you if
  the requesting page is itself one of your link hosts. You get a native
  Allow/Disallow dialog; Allow whitelists the target permanently, Disallow
  blacklists it permanently — either way you're not asked again. If the
  requesting page *isn't* one of your link hosts (e.g. it only got
  whitelisted as someone else's dependency, or via direct navigation but
  never added as a link), any site it tries to reach is blocked
  automatically with no prompt.
- A small initial whitelist covers common non-tracking security widgets
  (Cloudflare Turnstile, reCAPTCHA, hCaptcha) so they aren't broken by the
  default-deny policy.
- The welcome page's menu has "Site whitelist"/"Site blacklist" sections
  listing every hostname with a remove button — removing an entry reverts
  it to undecided, so it'll be asked about again next time it's requested.

## To-do list & focus mode

The welcome page's hamburger menu has a "To-do list…" entry that opens a
manager modal — this is separate from edit mode, always accessible. Each task
has a name, optional description, due date/time, a repeat frequency (once,
daily, weekly, monthly, or every N days/weeks/months), and a set of your own
site groups marked as "needed to complete it".

- The welcome page shows a to-do card for today's (and any still-incomplete
  earlier) occurrences; after 6pm local time it also previews tomorrow's.
  Completed-today items show crossed out (name in white, description in
  smaller gray). Check the box to mark one done.
- **Once any task is overdue and incomplete, browsing is restricted to only
  the sites in that task's linked groups** — everything else (even sites
  otherwise on your whitelist) is blocked until it's done. If more than one
  task is overdue at once, click whichever row you're currently working on;
  until you pick one, *everything* is blocked (forcing a choice). This
  overrides the whitelist/blacklist system entirely, and even direct address
  bar navigation is affected — it's the one thing in this app that address
  bar entry doesn't bypass.
- Edit mode is disabled (with an explanation) while any task is overdue and
  incomplete, so you can't sidestep focus mode by editing your groups.

## Building & installing (Linux)

```
npm run dist
```

Builds an AppImage and a `.deb` into `dist/`.

- **`.deb`** — install with `sudo apt install ./dist/shield-browser_0.1.0_amd64.deb`.
  Adds a menu entry ("Shield Browser") that launches correctly out of the box —
  the sandbox flag is baked into its desktop entry.
- **AppImage** — run it via `./run-appimage.sh`, which launches the built
  `dist/*.AppImage` with `--no-sandbox`. The raw `.AppImage` file can't be
  double-clicked directly: unlike the `.deb`, there's no desktop-entry hook to
  bake the flag into a single-file artifact, and Chromium's sandbox helper
  can't be fixed the normal way (`chown root` + `chmod 4755`) because AppImage
  extracts it to a fresh, differently-named temp path on every launch.

## Known limitations

- The ad list is a curated set of common ad/tracker domains, not a full
  EasyList/EasyPrivacy — good for everyday browsing, not exhaustive.
- Cookie blocking works by stripping `Cookie`/`Set-Cookie` headers on the
  default (non-opted-in) session partition, rather than disabling storage
  entirely.
- Shield opt-in state lives only in memory for the life of a tab; it isn't
  persisted per-origin.
- A recurring task that's been missed for a while doesn't show one row per
  missed day — it shows a single "carried over" row for its most recent
  occurrence. Doing it clears that row; the next occurrence (whenever it
  naturally falls) becomes the new pending one.
- A monthly task due on the 31st clamps to the last day of shorter months
  (e.g. the 28th/29th in February).
- The edit-mode-lockout message is a native `alert()`, not a themed dialog.
- "Same site" (for deciding whether a request is first-party) is approximated
  by comparing the last two dot-separated labels of the hostname, not a real
  public-suffix list — this misclassifies multi-part TLDs like `.co.uk`.
- Whitelist/blacklist entries show only the hostname, not the page title —
  Electron can't read a title for embedded resources (scripts/iframes) that
  never load as a full page.
- The site-access approval popup is a native OS dialog (Allow/Disallow), not
  a themed in-app modal.

## License

[MIT](LICENSE)
