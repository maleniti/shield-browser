const fs = require('fs');
const path = require('path');

// Utility/security-widget/CDN domains that don't themselves track across
// sites, pre-approved so common site functionality (bot-check widgets, hosted
// fonts, common JS libraries) isn't broken by the default-deny policy below.
// Not "link" hosts: they can be embedded anywhere, but per the leaf-node rule
// they can't request further sites.
const INITIAL_WHITELIST = [
  // Bot-check / security widgets
  'challenges.cloudflare.com',
  'hcaptcha.com',
  'newassets.hcaptcha.com',
  'js.hcaptcha.com',
  'recaptcha.net',
  'www.recaptcha.net',
  'www.gstatic.com',
  // Fonts
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'p.typekit.net',
  // Common JS library CDNs
  'code.createjs.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'ajax.googleapis.com',
  'code.jquery.com',
];

let filePath = null;
let data = { whitelist: {}, blacklist: {}, linkHosts: [] };

function load(userDataPath) {
  filePath = path.join(userDataPath, 'site-lists.json');
  let existed = true;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    existed = false;
    data = { whitelist: {}, blacklist: {}, linkHosts: [] };
  }

  // Also merge any newly-added INITIAL_WHITELIST entries into an existing
  // install (not just fresh ones), skipping anything already explicitly
  // blacklisted so a deliberate user decision is never silently overridden.
  let changed = !existed;
  for (const host of INITIAL_WHITELIST) {
    if (!isWhitelisted(host) && !isBlacklisted(host)) {
      data.whitelist[host] = true;
      changed = true;
    }
  }
  if (changed) save();
}

function save() {
  if (!filePath) return;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function isWhitelisted(hostname) {
  return Object.prototype.hasOwnProperty.call(data.whitelist, hostname);
}

function isBlacklisted(hostname) {
  return Object.prototype.hasOwnProperty.call(data.blacklist, hostname);
}

function isLinkHost(hostname) {
  return data.linkHosts.includes(hostname);
}

function addToWhitelist(hostname) {
  delete data.blacklist[hostname];
  data.whitelist[hostname] = true;
  save();
}

function addToBlacklist(hostname) {
  delete data.whitelist[hostname];
  data.blacklist[hostname] = true;
  save();
}

function removeFromWhitelist(hostname) {
  delete data.whitelist[hostname];
  save();
}

function removeFromBlacklist(hostname) {
  delete data.blacklist[hostname];
  save();
}

function getWhitelist() {
  return Object.keys(data.whitelist);
}

function getBlacklist() {
  return Object.keys(data.blacklist);
}

function setLinkHosts(hostnames) {
  data.linkHosts = [...new Set(hostnames)];
  save();
}

// SHORTCUT: approximates the registrable domain (eTLD+1) by taking the last
// two dot-separated labels, rather than using a real public-suffix list.
// This misclassifies multi-part TLDs (e.g. "a.example.co.uk" vs
// "b.example.co.uk" both simplify to "co.uk" and would wrongly be treated as
// the same site). Ceiling: swap in the `psl` package or an inlined public
// suffix list if this ever needs to be precise.
function registrableDomain(hostname) {
  const parts = hostname.split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

function isSameSite(hostnameA, hostnameB) {
  return registrableDomain(hostnameA) === registrableDomain(hostnameB);
}

module.exports = {
  load,
  isWhitelisted,
  isBlacklisted,
  isLinkHost,
  addToWhitelist,
  addToBlacklist,
  removeFromWhitelist,
  removeFromBlacklist,
  getWhitelist,
  getBlacklist,
  setLinkHosts,
  isSameSite,
};
