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
      'The ad list is a curated set of common ad/tracker domains, not a full EasyList/EasyPrivacy.',
      'Cookie blocking strips Cookie/Set-Cookie headers rather than disabling storage entirely.',
      "The per-tab shield choice isn't persisted across restarts.",
      'A recurring task missed for a while shows one carried-over row, not one per missed day.',
      'A monthly task due on the 31st clamps to the last day of shorter months.',
      '"Same site" is approximated by the last two dot-separated labels of the hostname, not a real public-suffix list -- misclassifies multi-part TLDs like .co.uk.',
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
