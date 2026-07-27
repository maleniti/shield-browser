// Changelog shown in the About dialog (hamburger menu). Each entry:
// { version, date, added: [...], fixed: [...], known: [...] }. `version` is
// null for not-yet-released work in progress ("Unreleased"). `known` (open
// issues as of that point) is only populated on the entry where it's
// actually useful to show it -- none of the items below have been resolved
// since v0.1.0, so it isn't repeated on every later entry, just the most
// recent one relevant to it.
//
// UMD-lite like recurrence.js: module.exports under Node, window.CHANGELOG
// via a plain <script> include in the welcome page.
const CHANGELOG = [
  {
    version: null,
    label: 'Unreleased',
    date: null,
    added: [
      'Multiple to-do tasks due the same day are now sorted by due time, then alphabetically by name for ties.',
      'Double-clicking a task on the welcome page\'s to-do list opens its edit form directly -- for a recurring task, first asking whether to edit only that occurrence, that occurrence and all following ones, or the whole series. Editing "only this occurrence" or "this and following" splits the series: the historical portion ends at the prior occurrence (its own past occurrences are auto-marked done, so it can\'t linger as a stuck "carried over" item), and the edited part continues as its own task (or a standalone one-off, for a single occurrence) with the original settings otherwise undisturbed. Changing the "Due date" field while splitting moves the split point itself to that date instead of the occurrence originally double-clicked.',
      'A Focus button on each of today\'s to-do tasks lets you voluntarily enter focus mode for it, even if it\'s not overdue and other tasks are -- same rules as overdue-triggered focus mode (browsing restricted to that task\'s linked groups). Only one task can be focused at a time, and it can be toggled back off (a carried-over, already-past task still can\'t -- it has no button here, keeping the older non-escapable behavior when it\'s the sole overdue task).',
      'In edit mode, link groups and the links within them can be reordered by drag and drop; dragging over a group/link list\'s scroll arrow slowly scrolls it so an item can be dropped into a row currently scrolled out of view.',
      'Tasks can be marked "all day" (no specific due time) -- shown first within each day\'s list, in light blue, and only overdue once that day itself has passed rather than at a particular time. A daily-recurring (every 1 day) all-day task is treated as one continuous multi-day task instead of independent daily occurrences, so it\'s only overdue once past its end date (or never, if it doesn\'t have one).',
      'Tasks can be marked "passive" (abstinence, e.g. "no social media") -- shown in light brown, these block their linked site groups instead of requiring them, for as long as they\'re due (until their due time, or all day). They can\'t be focused, checked off, or become overdue; each occurrence completes on its own once its window ends. If a passive task\'s groups overlap with an active task that currently needs them, it stays paused (crossed out, not blocking) until that conflict resolves -- saving a passive task that already conflicts today shows a heads-up explaining why.',
      'The task edit form has its own Delete button (two-click arm/confirm), so deleting no longer requires the manage-list view. For a recurring task edited via double-click, it deletes only whatever scope was chosen (this occurrence, this and following, or the whole series) -- deleting "only this occurrence" leaves the rest of the series intact on both sides of it. Editing via the manage list\'s own edit button always deletes the whole series.',
      'Each day header in the to-do list has a "+" button that opens the add-task form pre-filled with that day\'s due date.',
      'The welcome page\'s currently-selected search engine now counts as a link host, same as a site added as your own shortcut -- clicking through a search result now prompts to allow/disallow the destination instead of always being silently auto-blocked (a search-results page was never itself something you could add as a link, so its outbound clicks previously had no way to ever prompt).',
    ],
    fixed: [
      'Typing a hostname variant of a site already saved as a link (e.g. "example.com" when "www.example.com" is the saved link) no longer re-offers to add it as a link -- it was only being compared by exact hostname string, so a variant never directly typed before looked like a brand-new site.',
      'The blocked-page message for a voluntarily-focused (not overdue) task no longer misleadingly says "you have an overdue to-do task" -- it now says you\'re focused on a task that doesn\'t need this site.',
      'The to-do list\'s up/down scroll arrows now page by 3/4 of the visible list\'s height instead of by exactly one task -- a one-task step stopped making sense once day headers grouped the list, since it no longer lined up with a meaningful boundary.',
      'Visiting a site that redirects to a different hostname (e.g. ynab.com -> www.ynab.com) only kept the redirect target reachable for that one navigation chain -- toggling the per-tab JS/cookies shield (which reloads the tab\'s current, already-redirected URL from scratch) or relaunching the app would land directly on the redirect target and get blocked as "not on your whitelist", even though the original site was trusted. The redirect target is now whitelisted permanently the first time it\'s reached this way, same as the site you actually typed.',
      'A link host\'s own internal redirects to a different subdomain (e.g. DuckDuckGo search queries landing on html.duckduckgo.com) are now recognized as the same trusted site instead of a stranger -- this check was comparing hostnames exactly rather than by registrable domain, same underlying issue as the link-de-duplication fix above.',
    ],
    known: [
      'On a system set to a dark OS/GTK theme, sites get `prefers-color-scheme: dark` (Electron\'s nativeTheme follows the OS by default) -- some sites\' dark stylesheets are buggy under this (e.g. uniqlo.com: dark background, but body text stays black, unreadable). Forcing nativeTheme.themeSource to \'light\' fixes it but overrides every site\'s dark mode outright, including ones that support it correctly -- deliberately not done; a more targeted workaround is still needed.',
      'A site that depends on many third-party domains to function (e.g. ynab.com) triggers a separate allow/disallow prompt for each one, with no information about what the domain actually is or does -- there\'s no way to make an informed choice beyond the bare hostname. Disallowing one permanently blacklists it, which can silently break or degrade the site\'s functionality with no clear indication of which blocked domain was responsible or an easy way to reconsider just that one.',
    ],
  },
  {
    version: '0.1.3',
    date: '2026-07-25',
    added: [
      'To-do list: a toggle (upper-right of the panel) switches between the current "pending/overdue" view and a "next recurrence" view showing every task grouped under its next due date -- persisted across restarts. Checking a task off immediately reveals its next occurrence; today\'s completed occurrence still shows crossed out alongside it if that\'s what was just done.',
      'The to-do list panel now stays visible whenever any tasks exist, even if none are due today/tomorrow, so the view-mode toggle stays reachable.',
      'To-do manage modal: a toggle (upper-right) hides tasks that are both completed and past their end date, decluttering a long-lived list without deleting anything.',
      'Recurring tasks support an optional end date, and the manage-list scrollbar (like the whitelist/blacklist one) is restyled to match the app instead of the OS default.',
      'Weekly tasks can recur on specific days of the week (e.g. Mon/Wed/Fri) instead of just the due date\'s own weekday.',
      'Monthly tasks can recur on the last day of the month, N days before the last day (0-3), or the 1st/2nd/3rd/4th/5th/last occurrence of a given weekday (e.g. "last Friday", "3rd Tuesday") -- in addition to the existing "same day of month as the due date" pattern.',
    ],
    fixed: [
      "Ads/trackers are now matched against a bundled EasyList/EasyPrivacy filter engine (@ghostery/adblocker-electron) instead of a small curated domain list -- far broader coverage, refreshed via scripts/build-adblock-engine.js.",
      '"Same site" (for first-party request detection) now uses a real public-suffix list (tldts) instead of a naive last-two-labels split -- fixes multi-part TLDs like .co.uk, where two unrelated sites used to both reduce to "co.uk" and get wrongly treated as the same site.',
      "Native dropdown menus (search engine, task frequency/pattern fields) are now styled dark to match the rest of the app, instead of the OS's bright default popup.",
      'To-do manage modal: the close button (easily mistaken for the view-filter toggle in the same corner) moved to the corner in its place; the filter toggle moved inline next to the title.',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-07-25',
    added: [
      'Site whitelist/blacklist modal: manually add a hostname to either list (not just remove entries), with a one-way "move to blacklist" button on whitelist entries, and a scrollbar restyled to match the app instead of the OS default.',
      'Subtle glass-distortion effect (SVG feTurbulence/feDisplacementMap plus a touch of blur) on the panels, replacing a flat blur() that was strong enough to obscure background image text.',
      'The taskbar/window-manager icon now shows the actual app icon instead of a generic placeholder.',
      'Day headers ("Today, ...", "Tomorrow, ...", "Yesterday, ...", or a plain date) group the to-do list instead of one flat list.',
      'Deleting a task uses the same two-click arm/confirm pattern as removing a site link, instead of a native confirm() dialog.',
      'Recurring tasks can have an optional end date -- the last recurrence lands on or before it, none after.',
      'This About dialog.',
    ],
    fixed: [
      "Refuse to whitelist a site that's blocked by default (ads/social), manually or as a group link -- it would've been a misleading no-op entry either way.",
      'A main-process crash (webContents.fromId(undefined)) on certain requests with no associated tab, e.g. a background prefetch/beacon outliving the tab that spawned it.',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-07-23',
    added: [
      'Default background image on first launch, instead of a bare background.',
      "Fresh installs start with no predefined groups/links/tasks (existing users' own data is untouched); clear empty-state messaging with a direct action button for both the links and to-do sections.",
      'The to-do list has its own bounded scroll viewport with up/down buttons (one task at a time), moved below the links -- the whole welcome page is a fixed-height layout that never scrolls itself, with responsive breakpoints for shorter windows.',
      'Frameless window with custom minimize/maximize/restore/close buttons in the tab strip.',
    ],
    fixed: [
      'Clarified that the AppImage sandbox workaround is an Ubuntu/AppArmor-specific issue, not a general Electron/AppImage limitation (confirmed the same AppImage runs fine unmodified on Debian).',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-23',
    added: [
      'Always-on ad and social media blocking, not user-configurable.',
      'Per-tab JavaScript/cookies shield, blocked by default with a one-click opt-in.',
      'Default-deny site whitelist/blacklist: direct navigation auto-whitelists; a site only gains "link host" trust (letting pages it links to prompt for access) by being added as a welcome-page shortcut; everything else is blocked with no prompt.',
      'To-do list with recurring tasks (once/daily/weekly/monthly/every N) and focus mode: an overdue incomplete task restricts browsing to only its linked site groups, overriding the whitelist entirely.',
      'Welcome/new-tab page with a search bar (configurable engine) and your own groups of site shortcuts.',
      'Tabs, address bar, back/forward/reload.',
      'Linux packaging: AppImage and .deb via electron-builder.',
    ],
    known: [
      'Cookie blocking strips Cookie/Set-Cookie headers rather than disabling storage entirely.',
      "The per-tab shield choice isn't persisted across restarts.",
      'A monthly task due on the 31st clamps to the last day of shorter months.',
      'Whitelist/blacklist entries show only the hostname, not the page title.',
      'The site-access approval popup is a native OS dialog, not a themed in-app modal.',
    ],
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CHANGELOG;
} else {
  window.CHANGELOG = CHANGELOG;
}
