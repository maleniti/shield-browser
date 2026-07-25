const SOCIAL_DOMAINS = require('./social');

function hostMatches(hostname, list) {
  hostname = hostname.toLowerCase();
  return list.some((d) => hostname === d || hostname.endsWith('.' + d));
}

// Social media only -- ad/tracker matching moved to the bundled
// EasyList/EasyPrivacy engine (see adblockEngine.js) for far broader
// coverage than a hand-curated domain list could offer.
function classify(requestUrl) {
  let hostname;
  try {
    hostname = new URL(requestUrl).hostname;
  } catch {
    return null;
  }
  if (hostMatches(hostname, SOCIAL_DOMAINS)) return { kind: 'social', hostname };
  return null;
}

module.exports = { hostMatches, classify };
