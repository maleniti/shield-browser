const fs = require('fs');
const path = require('path');
const { getDomain } = require('tldts-experimental');

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

// Is `hostname` the same site (registrable domain) as one already saved as a
// link, even if the exact hostname string differs (e.g. "example.com" vs
// "www.example.com")? Used to avoid re-offering to add a site as a link
// (see main.js's handleDirectNavigation) just because the user typed a
// different-but-equivalent hostname variant of a site they already have
// saved -- isWhitelisted()/isLinkHost() alone do an exact-string match, so a
// hostname variant they'd never typed before looks "new" even when it isn't.
function isSameSiteAsAnyLinkHost(hostname) {
  return data.linkHosts.some((h) => isSameSite(h, hostname));
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

// Public-suffix-list-aware registrable domain (eTLD+1), via tldts (already
// in the dependency tree through @ghostery/adblocker-electron) -- correctly
// handles multi-part TLDs like .co.uk, unlike a naive last-two-labels split
// ("example1.co.uk" and "example2.co.uk" used to both reduce to just
// "co.uk" and be wrongly treated as the same site).
function registrableDomain(hostname) {
  return getDomain(hostname) || hostname; // no recognized public suffix (IP address, localhost, etc.) -- treat the whole hostname as its own site
}

function isSameSite(hostnameA, hostnameB) {
  return registrableDomain(hostnameA) === registrableDomain(hostnameB);
}

module.exports = {
  load,
  isWhitelisted,
  isBlacklisted,
  isLinkHost,
  isSameSiteAsAnyLinkHost,
  addToWhitelist,
  addToBlacklist,
  removeFromWhitelist,
  removeFromBlacklist,
  getWhitelist,
  getBlacklist,
  setLinkHosts,
  isSameSite,
};
