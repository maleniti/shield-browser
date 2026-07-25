const assert = require('node:assert');
const { classify } = require('./match');

assert.deepStrictEqual(classify('https://www.facebook.com/foo'), { kind: 'social', hostname: 'www.facebook.com' });
assert.deepStrictEqual(classify('https://facebook.com'), { kind: 'social', hostname: 'facebook.com' });
assert.strictEqual(classify('https://www.example.com'), null);
// Ad/tracker matching moved to the bundled EasyList/EasyPrivacy engine (see
// adblockEngine.js) -- classify() no longer classifies 'ad', only 'social'.
assert.strictEqual(classify('https://doubleclick.net/x'), null);
assert.strictEqual(classify('https://facebookish.com'), null); // must not match on substring, only domain/subdomain
assert.strictEqual(classify('not a url'), null);

console.log('match.test.js: all assertions passed');
