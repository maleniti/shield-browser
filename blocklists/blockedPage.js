// Renders the "blocked" interstitial with the hostname already baked into the
// HTML. This can't rely on client-side JS to fill it in: the default tab has
// javascript:false, and social blocking must show correctly whether or not
// that tab has opted in to JS.
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const REASONS = {
  social: (host) => `<code>${host}</code> is a social media site and is always blocked
    by this browser. There is no setting to unblock it.`,
  blacklisted: (host) => `<code>${host}</code> has been permanently disallowed and is always
    blocked. You can remove it from your blacklist in the welcome page's menu if you change
    your mind.`,
  'not-whitelisted': (host) => `<code>${host}</code> is not on your whitelist, and the site that
    tried to open it isn't one of your own links, so it was blocked automatically without asking.`,
  'focus-mode': (host) => `<code>${host}</code> is blocked because you have an overdue to-do task.
    Only sites needed for that task are reachable until it's marked done -- check the to-do list
    on the welcome page.`,
};

function renderBlockedPage(hostname, reason = 'social') {
  const safeHost = escapeHtml(hostname);
  const message = (REASONS[reason] || REASONS.social)(safeHost);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Site blocked</title>
<style>
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: #202124;
    color: #e8eaed;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    margin: 0;
  }
  .card {
    text-align: center;
    max-width: 420px;
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 14px; color: #9aa0a6; line-height: 1.5; }
  code { background: #3c4043; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128737;&#65039;</div>
    <h1>This site is blocked</h1>
    <p>${message}</p>
  </div>
</body>
</html>
`;
}

module.exports = { renderBlockedPage };
