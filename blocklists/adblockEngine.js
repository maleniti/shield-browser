// Wraps the bundled EasyList/EasyPrivacy filter engine (see
// scripts/build-adblock-engine.js for how blocklists/adblock-engine.bin is
// generated) so main.js can query it the same way it queries the curated
// social-media list in match.js, without depending on the adblocker
// package's own session-hooking helpers (enableBlockingInSession would
// register its own webRequest.onBeforeRequest listener on the session --
// Electron only supports one such listener per session, and main.js's own
// whitelist/focus-mode gate already needs that slot).
const fs = require('fs');
const path = require('path');
const { ElectronBlocker, Request, fromElectronDetails } = require('@ghostery/adblocker-electron');

const ENGINE_PATH = path.join(__dirname, 'adblock-engine.bin');

let engine = null;

// Missing/corrupt snapshot degrades to "nothing matches" rather than
// crashing the app -- e.g. a checkout that hasn't run the build script yet.
function load() {
  try {
    engine = ElectronBlocker.deserialize(fs.readFileSync(ENGINE_PATH));
  } catch (err) {
    engine = null;
    console.error(`Could not load ${ENGINE_PATH} -- ad/tracker blocking via EasyList/EasyPrivacy is disabled:`, err.message);
  }
}

// Full-context check for the live webRequest path: knows the resource type
// and referrer, so third-party/type-scoped filter rules apply correctly.
// Some filters replace a request with an inert stub (e.g. a 1x1 transparent
// image) rather than cancelling it outright -- redirectURL is that stub's
// data: URL when present, so callers can honor it instead of just cancelling.
function matchRequest(details) {
  if (!engine) return { match: false, redirectURL: null };
  const { match, redirect } = engine.match(fromElectronDetails(details));
  return { match, redirectURL: redirect ? redirect.dataUrl : null };
}

// Coarser check with no real request context, for the "would this ever be
// blocked" queries that only have a URL or bare hostname to go on (direct
// navigation, whitelist-add guard). Most tracking rules are $third-party
// scoped, and without *some* sourceUrl the engine can't tell first- from
// third-party and skips those rules entirely -- a bare same-origin check
// under-matched almost everything (confirmed empirically: real trackers
// like doubleclick.net and google-analytics.com came back unmatched without
// this). A deliberately different placeholder origin makes third-party
// rules evaluate as such, which is what's actually true the overwhelming
// majority of the time for an ad/tracker domain.
function matchUrl(url) {
  if (!engine) return false;
  return engine.match(Request.fromRawDetails({ url, sourceUrl: 'https://example.org/', type: 'other' })).match;
}

module.exports = { load, matchRequest, matchUrl };
