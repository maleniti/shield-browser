const assert = require('node:assert');

// Load path is a private module-level constant, so exercise the "missing
// snapshot" resilience the same way it'd actually happen: point require's
// cache-busted copy at a non-existent file by loading the real module and
// checking its behavior before load() is ever called succeeds (never-loaded
// state), which shares the same "no engine" fallback path as a failed load.
const adblockEngine = require('./adblockEngine');

assert.deepStrictEqual(adblockEngine.matchRequest({ url: 'https://doubleclick.net/x', resourceType: 'script' }), {
  match: false,
  redirectURL: null,
});
assert.strictEqual(adblockEngine.matchUrl('https://doubleclick.net/x'), false);

// The real bundled snapshot should load without throwing and actually match
// a well-known ad domain -- a sanity check that scripts/build-adblock-engine.js
// produced a working blocklists/adblock-engine.bin, not just any file.
adblockEngine.load();
const result = adblockEngine.matchRequest({
  url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  resourceType: 'script',
  referrer: 'https://example.com',
});
assert.strictEqual(result.match, true, 'bundled engine should block a well-known ad domain');
assert.strictEqual(adblockEngine.matchUrl('https://www.example.com'), false, 'an ordinary site should not match');
assert.strictEqual(
  adblockEngine.matchUrl('https://doubleclick.net'),
  true,
  'a bare hostname with no path should still match a well-known tracker (needs the synthetic third-party sourceUrl -- most tracking rules are $third-party scoped and are skipped entirely without one)'
);

console.log('adblockEngine.test.js: all assertions passed');
