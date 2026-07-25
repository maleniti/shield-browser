const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-lists-test-'));
const siteLists = require('./siteLists');
siteLists.load(tmpDir);

assert.ok(siteLists.isWhitelisted('challenges.cloudflare.com'), 'initial whitelist seeded');
assert.ok(!siteLists.isWhitelisted('example.com'));

siteLists.addToBlacklist('evil.com');
assert.ok(siteLists.isBlacklisted('evil.com'));
siteLists.addToWhitelist('evil.com'); // whitelisting must clear any prior blacklist entry
assert.ok(!siteLists.isBlacklisted('evil.com'));
assert.ok(siteLists.isWhitelisted('evil.com'));

siteLists.addToBlacklist('good.com');
assert.ok(!siteLists.isWhitelisted('good.com'), 'blacklisting must clear any prior whitelist entry');

siteLists.setLinkHosts(['github.com', 'github.com', 'news.ycombinator.com']);
assert.ok(siteLists.isLinkHost('github.com'));
assert.ok(!siteLists.isLinkHost('example.com'));
assert.strictEqual(siteLists.getWhitelist().length, siteLists.getWhitelist().filter((h) => h).length);

assert.ok(siteLists.isSameSite('api.github.com', 'github.com'));
assert.ok(!siteLists.isSameSite('github.com', 'github.io'));

// Multi-part TLDs (public-suffix-list aware via tldts, not a naive
// last-two-labels split): subdomains of the same .co.uk site are the same
// site, but two different .co.uk sites are not (the old heuristic wrongly
// reduced both to just "co.uk" and treated them as identical).
assert.ok(siteLists.isSameSite('a.example.co.uk', 'b.example.co.uk'), 'same registrable domain under a multi-part TLD');
assert.ok(!siteLists.isSameSite('example1.co.uk', 'example2.co.uk'), 'different sites sharing a multi-part TLD are not the same site');

// Hosts with no recognized public suffix (IP addresses, bare hostnames) fall
// back to treating the whole hostname as its own site.
assert.ok(siteLists.isSameSite('192.168.1.1', '192.168.1.1'));
assert.ok(!siteLists.isSameSite('192.168.1.1', '192.168.1.2'));

// Persistence: reload from the same directory and confirm state survived.
siteLists.load(tmpDir);
assert.ok(siteLists.isWhitelisted('evil.com'));
assert.ok(siteLists.isLinkHost('github.com'));

// Simulate an existing install predating a newly-added INITIAL_WHITELIST
// entry: load() should backfill it in, but never override a domain the user
// deliberately blacklisted even if it later gets added to INITIAL_WHITELIST.
const legacyFile = path.join(tmpDir, 'site-lists.json');
const legacyData = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
delete legacyData.whitelist['fonts.googleapis.com'];
delete legacyData.whitelist['cdnjs.cloudflare.com']; // mutually exclusive with blacklist, as addToBlacklist enforces
legacyData.blacklist['cdnjs.cloudflare.com'] = true;
fs.writeFileSync(legacyFile, JSON.stringify(legacyData));

siteLists.load(tmpDir);
assert.ok(siteLists.isWhitelisted('fonts.googleapis.com'), 'missing initial-whitelist entry gets backfilled');
assert.ok(siteLists.isBlacklisted('cdnjs.cloudflare.com'), 'user blacklist decision is never overridden by INITIAL_WHITELIST');
assert.ok(!siteLists.isWhitelisted('cdnjs.cloudflare.com'));

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('siteLists.test.js: all assertions passed');
