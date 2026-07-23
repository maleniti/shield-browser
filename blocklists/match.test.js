const assert = require('node:assert');
const { classify } = require('./match');

assert.deepStrictEqual(classify('https://www.facebook.com/foo'), { kind: 'social', hostname: 'www.facebook.com' });
assert.deepStrictEqual(classify('https://facebook.com'), { kind: 'social', hostname: 'facebook.com' });
assert.deepStrictEqual(classify('https://doubleclick.net/x'), { kind: 'ad', hostname: 'doubleclick.net' });
assert.deepStrictEqual(classify('https://pagead2.googlesyndication.com/x'), { kind: 'ad', hostname: 'pagead2.googlesyndication.com' });
assert.strictEqual(classify('https://www.example.com'), null);
assert.strictEqual(classify('https://facebookish.com'), null); // must not match on substring, only domain/subdomain
assert.strictEqual(classify('not a url'), null);

console.log('match.test.js: all assertions passed');
