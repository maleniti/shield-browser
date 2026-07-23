const SOCIAL_DOMAINS = require('./social');
const AD_DOMAINS = require('./ads');

function hostMatches(hostname, list) {
  hostname = hostname.toLowerCase();
  return list.some((d) => hostname === d || hostname.endsWith('.' + d));
}

function classify(requestUrl) {
  let hostname;
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    return null;
  }
  if (hostMatches(hostname, SOCIAL_DOMAINS)) return { kind: 'social', hostname };
  if (hostMatches(hostname, AD_DOMAINS)) return { kind: 'ad', hostname };
  return null;
}

module.exports = { hostMatches, classify };
