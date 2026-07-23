const STORAGE_KEY = 'shield-browser-groups';

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function loadGroups() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to empty
  }
  return [];
}

let groups = loadGroups();
syncLinkHostsOnly(); // report the current link hosts to main.js on every fresh load, not just edits

function syncLinkHostsOnly() {
  const hostnames = groups.flatMap((g) => g.sites.map((s) => hostnameOf(s.url))).filter(Boolean);
  window.siteListAPI.syncLinkHosts(hostnames);
}

function saveGroups() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  // Being "one of the user's own links" is what grants a site the privilege
  // of cascading further site-access approvals (see siteLists.js) -- keep
  // the main process's copy of that set in sync with every edit.
  syncLinkHostsOnly();
}

function hostnameOf(siteUrl) {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return null;
  }
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 45%)`;
}

// Tries the site's own favicon.ico first, then falls back to Google's
// favicon proxy (for sites that don't serve one at that standard path).
// Displaying via <img> doesn't need CORS headers -- only reading pixel
// data back out would -- so this works for arbitrary third-party sites.
function faviconCandidates(siteUrl) {
  try {
    const { origin, hostname } = new URL(siteUrl);
    return [
      `${origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`,
    ];
  } catch {
    return [];
  }
}

// render() rebuilds every tile from scratch on any edit, which would
// otherwise re-probe every site's favicon candidates on every unrelated
// change. Cache the outcome on the site record itself (persisted via
// saveGroups) so a resolved favicon is reused directly, and a confirmed
// "no favicon found" is remembered instead of being retried forever.
function resolveFavicon(site, onSuccess) {
  if (site.favicon === false) return;

  if (site.favicon) {
    const img = new Image();
    img.onload = () => onSuccess(img);
    img.onerror = () => {
      site.favicon = undefined; // the cached URL stopped working; re-probe
      probeFaviconCandidates(site, onSuccess);
    };
    img.src = site.favicon;
    return;
  }

  probeFaviconCandidates(site, onSuccess);
}

function probeFaviconCandidates(site, onSuccess) {
  const candidates = faviconCandidates(site.url);
  let i = 0;
  function tryNext() {
    if (i >= candidates.length) {
      site.favicon = false;
      saveGroups();
      return;
    }
    const img = new Image();
    img.onload = () => {
      site.favicon = candidates[i];
      saveGroups();
      onSuccess(img);
    };
    img.onerror = () => {
      i++;
      tryNext();
    };
    img.src = candidates[i];
  }
  tryNext();
}

const groupsEl = document.getElementById('groups');

// window.prompt() has no native implementation on Linux (Chromium doesn't
// provide an OS text-input dialog there), so it silently no-ops. This modal
// replaces it for every case that needs free-text input; confirm() still
// works fine cross-platform and is used as-is for delete confirmations.
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = modalOverlay.querySelector('.modal-title');
const modalFields = modalOverlay.querySelector('.modal-fields');
const modalOk = modalOverlay.querySelector('.modal-ok');
const modalCancel = modalOverlay.querySelector('.modal-cancel');

// fields: [{ name, label, value, placeholder, required }] for text/date/time
// fields (type defaults to 'text', also accepts 'date'/'time'/'textarea'),
// [{ name, label, type: 'select', options: [{value, label}], value }] for a
// select, or [{ name, label, type: 'checkboxes', options: [{value, label}],
// value: string[] }] for a multi-select (resolves to an array). Fields
// default to required (non-empty / non-empty-array); pass required: false to
// allow blank. Resolves { [field.name]: value } on OK, or null on
// Cancel/Escape. opts.okLabel/cancelLabel override the button text.
function showFormModal(title, fields, opts = {}) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalFields.innerHTML = '';
    modalOk.textContent = opts.okLabel || 'OK';
    modalCancel.textContent = opts.cancelLabel || 'Cancel';

    const interactiveEls = [];
    const fieldGetters = fields.map((field) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-field';

      const label = document.createElement('label');
      label.textContent = field.label;
      wrap.appendChild(label);

      let getValue;
      if (field.type === 'select') {
        const select = document.createElement('select');
        select.className = 'modal-input';
        for (const option of field.options) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          select.appendChild(optionEl);
        }
        if (field.value != null) select.value = field.value;
        wrap.appendChild(select);
        interactiveEls.push(select);
        getValue = () => select.value;
      } else if (field.type === 'checkboxes') {
        const box = document.createElement('div');
        box.className = 'modal-checkboxes';
        const checkboxes = field.options.map((option) => {
          const row = document.createElement('label');
          row.className = 'modal-checkbox-row';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = (field.value || []).includes(option.value);
          cb.dataset.value = option.value;
          row.appendChild(cb);
          const span = document.createElement('span');
          span.textContent = option.label;
          row.appendChild(span);
          box.appendChild(row);
          interactiveEls.push(cb);
          return cb;
        });
        wrap.appendChild(box);
        getValue = () => checkboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.value);
      } else if (field.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.className = 'modal-input modal-textarea';
        textarea.value = field.value || '';
        textarea.placeholder = field.placeholder || '';
        wrap.appendChild(textarea);
        interactiveEls.push(textarea);
        getValue = () => textarea.value.trim();
      } else {
        const input = document.createElement('input');
        input.className = 'modal-input';
        input.type = field.type || 'text';
        input.value = field.value || '';
        input.placeholder = field.placeholder || '';
        wrap.appendChild(input);
        interactiveEls.push(input);
        getValue = () => input.value.trim();
      }

      modalFields.appendChild(wrap);
      return { getValue, name: field.name, required: field.required !== false, isArray: field.type === 'checkboxes' };
    });

    modalOverlay.classList.remove('hidden');
    interactiveEls[0].focus();
    if (interactiveEls[0].select) interactiveEls[0].select();

    function finish(result) {
      modalOverlay.classList.add('hidden');
      modalOk.onclick = null;
      modalCancel.onclick = null;
      interactiveEls.forEach((el) => { el.onkeydown = null; });
      resolve(result);
    }

    function submit() {
      const result = {};
      for (const f of fieldGetters) {
        const value = f.getValue();
        if (f.required && (f.isArray ? value.length === 0 : !value)) return;
        result[f.name] = value;
      }
      finish(result);
    }

    modalOk.onclick = submit;
    modalCancel.onclick = () => finish(null);
    interactiveEls.forEach((el) => {
      el.onkeydown = (e) => {
        if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') submit();
        if (e.key === 'Escape') {
          e.stopPropagation(); // don't let the global edit-mode Escape handler also fire
          finish(null);
        }
      };
    });
  });
}

async function showPrompt(title, defaultValue = '') {
  const result = await showFormModal(title, [{ name: 'value', label: title, value: defaultValue }]);
  return result ? result.value : null;
}

function render() {
  groupsEl.innerHTML = '';

  if (groups.length === 0) {
    groupsEl.appendChild(renderGroupsEmptyState());
  } else {
    for (const group of groups) {
      const { el, updateScrollButtons } = renderGroup(group);
      groupsEl.appendChild(el);
      updateScrollButtons(); // needs real layout, so only measurable once attached
    }
  }

  updateGroupsLayout();
}

function renderGroupsEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state-wrap';

  const message = document.createElement('div');
  message.className = 'empty-state';
  message.textContent = 'You have no links defined yet. Add some using edit mode.';
  wrap.appendChild(message);

  const btn = document.createElement('button');
  btn.className = 'accent-btn enable-edit-mode-btn';
  btn.textContent = 'Turn on edit mode';
  btn.onclick = () => setEditMode(true);
  wrap.appendChild(btn);

  return wrap;
}

function renderGroup(group) {
  const el = document.createElement('div');
  el.className = 'group';

  const header = document.createElement('div');
  header.className = 'group-header';

  const h2 = document.createElement('h2');
  h2.textContent = group.name;
  h2.title = group.name; // full name on hover, since long titles are truncated
  h2.onclick = () => {
    if (document.body.classList.contains('edit-mode')) startInlineRename(group, h2);
  };
  header.appendChild(h2);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'edit-only group-delete-btn';
  deleteBtn.title = 'Delete group';
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
  deleteBtn.onclick = () => deleteGroup(group.id);
  header.appendChild(deleteBtn);

  el.appendChild(header);

  // Sites show as a fixed 2x2 grid; more than 4 sites overflow vertically
  // and are reached via the up/down bars instead of a native scrollbar
  // (same hidden-scrollbar-plus-custom-arrows approach as the tab strip).
  const scrollUpBtn = document.createElement('button');
  scrollUpBtn.className = 'sites-scroll-btn sites-scroll-up';
  scrollUpBtn.textContent = '⌃';
  scrollUpBtn.title = 'Previous 4';
  el.appendChild(scrollUpBtn);

  const viewport = document.createElement('div');
  viewport.className = 'sites-viewport';

  const sitesEl = document.createElement('div');
  sitesEl.className = 'sites';
  for (const site of group.sites) sitesEl.appendChild(renderSite(group.id, site));
  sitesEl.appendChild(renderAddSiteTile(group.id));
  viewport.appendChild(sitesEl);
  el.appendChild(viewport);

  const scrollDownBtn = document.createElement('button');
  scrollDownBtn.className = 'sites-scroll-btn sites-scroll-down';
  scrollDownBtn.textContent = '⌄';
  scrollDownBtn.title = 'Next 4';
  el.appendChild(scrollDownBtn);

  function updateScrollButtons() {
    const overflowing = viewport.scrollHeight > viewport.clientHeight + 1;
    scrollUpBtn.classList.toggle('visible', overflowing);
    scrollDownBtn.classList.toggle('visible', overflowing);
    if (!overflowing) return;
    scrollUpBtn.disabled = viewport.scrollTop <= 0;
    scrollDownBtn.disabled = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1;
  }

  // Paginate by exactly 2 rows (one set of 4 icons). This is deliberately
  // computed from the actual tile height + row gap rather than
  // viewport.clientHeight: the viewport includes extra top padding (room for
  // the hover-lift effect on the first row) that isn't part of a real "row",
  // so using clientHeight as the step under-scrolled by that padding amount
  // and clipped the newly-revealed row's label under the down-arrow bar.
  function pageStep() {
    const tile = sitesEl.querySelector('.site-tile, .add-site-tile');
    if (!tile) return viewport.clientHeight;
    const rowGap = parseFloat(getComputedStyle(sitesEl).rowGap || '10');
    return 2 * (tile.getBoundingClientRect().height + rowGap);
  }

  scrollUpBtn.onclick = () => viewport.scrollBy({ top: -pageStep(), behavior: 'smooth' });
  scrollDownBtn.onclick = () => viewport.scrollBy({ top: pageStep(), behavior: 'smooth' });
  viewport.addEventListener('scroll', updateScrollButtons);

  return { el, updateScrollButtons };
}

function renderSite(groupId, site) {
  const a = document.createElement('a');
  a.className = 'site-tile';
  a.href = site.url;
  a.title = site.url;
  // In edit mode the tile itself opens the edit modal instead of navigating
  // (the small pencil-icon overlay this used to need is gone -- the whole
  // tile does the job now).
  a.onclick = (e) => {
    if (document.body.classList.contains('edit-mode')) {
      e.preventDefault();
      editSite(groupId, site.id);
    }
  };

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'site-avatar-wrap';

  const avatar = document.createElement('div');
  avatar.className = 'site-avatar';
  avatar.style.background = colorFor(site.name);
  avatar.textContent = (site.name.trim()[0] || '?').toUpperCase();
  avatarWrap.appendChild(avatar);

  resolveFavicon(site, (img) => {
    avatar.textContent = '';
    avatar.classList.add('has-favicon');
    img.className = 'site-favicon';
    avatar.appendChild(img);
  });

  // Removing requires two clicks: the first arms it (X -> red !), the
  // second confirms. Moving off the tile disarms it back to X, so a later,
  // unrelated click can't land on an armed button and delete by accident.
  const removeBtn = document.createElement('button');
  removeBtn.className = 'site-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove site';
  let removeArmed = false;
  removeBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!removeArmed) {
      removeArmed = true;
      removeBtn.textContent = '!';
      removeBtn.title = 'Click again to remove';
      removeBtn.classList.add('confirm');
    } else {
      removeSite(groupId, site.id);
    }
  };
  avatarWrap.addEventListener('mouseleave', () => {
    if (!removeArmed) return;
    removeArmed = false;
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove site';
    removeBtn.classList.remove('confirm');
  });
  avatarWrap.appendChild(removeBtn);

  a.appendChild(avatarWrap);

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = site.name;
  a.appendChild(name);

  return a;
}

function renderAddSiteTile(groupId) {
  const btn = document.createElement('button');
  btn.className = 'add-site-tile edit-only';

  const avatar = document.createElement('div');
  avatar.className = 'add-tile-avatar';
  avatar.textContent = '+';
  btn.appendChild(avatar);

  const label = document.createElement('span');
  label.className = 'site-name';
  label.textContent = 'Add site';
  btn.appendChild(label);

  btn.onclick = () => addSite(groupId);
  return btn;
}

async function addGroup() {
  const name = await showPrompt('Group name');
  if (!name) return;
  groups.push({ id: uid(), name, sites: [] });
  saveGroups();
  render();
}

function startInlineRename(group, h2El) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-title-input';
  input.value = group.name;

  h2El.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      e.stopPropagation(); // don't let the global edit-mode Escape handler also fire
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    if (!cancelled) {
      const name = input.value.trim();
      if (name) {
        group.name = name;
        saveGroups();
      }
    }
    render();
  });
}

function deleteGroup(groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  if (!confirm(`Delete group "${group.name}" and all its sites?`)) return;
  groups = groups.filter((g) => g.id !== groupId);
  saveGroups();
  render();
}

async function addSite(groupId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  const result = await showFormModal('Add site', [
    { name: 'name', label: 'Site name', value: '' },
    { name: 'url', label: 'Site URL', value: '', placeholder: 'example.com' },
  ]);
  if (!result) return;
  const siteUrl = normalizeUrl(result.url);
  if (!siteUrl) return;
  group.sites.push({ id: uid(), name: result.name, url: siteUrl });
  window.siteListAPI.whitelistHost(hostnameOf(siteUrl));
  saveGroups();
  render();
}

function removeSite(groupId, siteId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.sites = group.sites.filter((s) => s.id !== siteId);
  saveGroups();
  render();
}

async function editSite(groupId, siteId) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  const site = group.sites.find((s) => s.id === siteId);
  if (!site) return;
  const result = await showFormModal('Edit site', [
    { name: 'name', label: 'Site name', value: site.name },
    { name: 'url', label: 'Site URL', value: site.url, placeholder: 'example.com' },
  ]);
  if (!result) return;
  const siteUrl = normalizeUrl(result.url);
  if (!siteUrl) return;
  site.name = result.name;
  site.url = siteUrl;
  site.favicon = undefined; // url/name changed; let it re-resolve rather than reuse a stale one
  window.siteListAPI.whitelistHost(hostnameOf(siteUrl));
  saveGroups();
  render();
}

document.getElementById('add-group-btn').onclick = addGroup;

// Groups viewport: shows exactly one row of group cards, paginating
// vertically to further rows the same way each group paginates its own
// sites -- a fixed step (one row height) rather than continuous scrolling.
const groupsViewportEl = document.getElementById('groups-viewport');
const groupsScrollUpBtn = document.getElementById('groups-scroll-up');
const groupsScrollDownBtn = document.getElementById('groups-scroll-down');

function updateGroupsScrollButtons() {
  const overflowing = groupsViewportEl.scrollHeight > groupsViewportEl.clientHeight + 1;
  groupsScrollUpBtn.classList.toggle('visible', overflowing);
  groupsScrollDownBtn.classList.toggle('visible', overflowing);
  if (!overflowing) return;
  groupsScrollUpBtn.disabled = groupsViewportEl.scrollTop <= 0;
  groupsScrollDownBtn.disabled = groupsViewportEl.scrollTop >= groupsViewportEl.scrollHeight - groupsViewportEl.clientHeight - 1;
}

function groupsRowStep() {
  const firstGroup = groupsEl.querySelector('.group');
  if (!firstGroup) return groupsViewportEl.clientHeight;
  const rowGap = parseFloat(getComputedStyle(groupsEl).rowGap || '20');
  return firstGroup.getBoundingClientRect().height + rowGap;
}

function updateGroupsLayout() {
  const firstGroup = groupsEl.querySelector('.group');
  groupsViewportEl.style.height = firstGroup ? firstGroup.getBoundingClientRect().height + 'px' : '';
  updateGroupsScrollButtons();
}

groupsScrollUpBtn.onclick = () => groupsViewportEl.scrollBy({ top: -groupsRowStep(), behavior: 'smooth' });
groupsScrollDownBtn.onclick = () => groupsViewportEl.scrollBy({ top: groupsRowStep(), behavior: 'smooth' });
groupsViewportEl.addEventListener('scroll', updateGroupsScrollButtons);
window.addEventListener('resize', updateGroupsLayout);

// Edit mode is in-memory only (never persisted), so it's always off again on
// a fresh page load -- a new tab or a reload of this page resets it.
const menuBtn = document.getElementById('menu-btn');
const menuDropdown = document.getElementById('menu-dropdown');
const editModeToggle = document.getElementById('edit-mode-toggle');

menuBtn.onclick = (e) => {
  e.stopPropagation();
  menuDropdown.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
    menuDropdown.classList.add('hidden');
  }
});
function setEditMode(on) {
  if (on && hasOverdueIncompleteTask()) {
    editModeToggle.checked = false; // revert the checkbox's own click-driven toggle
    alert('Finish your overdue to-do task before using edit mode.');
    return;
  }
  editModeToggle.checked = on;
  document.body.classList.toggle('edit-mode', on);
}

editModeToggle.onchange = () => setEditMode(editModeToggle.checked);

document.getElementById('exit-edit-mode-btn').onclick = () => setEditMode(false);

// The rename input and the add/edit-site modal each stopPropagation() on
// their own Escape handling (cancel rename / cancel modal), so this never
// double-fires when one of those is what the user meant to dismiss. Also
// skipped while the to-do manager is open, since that's a separate concern
// from edit mode and both listeners live on `document` (stopPropagation
// between sibling listeners on the same node doesn't suppress each other).
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'Escape' &&
    document.body.classList.contains('edit-mode') &&
    todoManageOverlay.classList.contains('hidden')
  ) {
    setEditMode(false);
  }
});

const SEARCH_ENGINE_STORAGE_KEY = 'shield-browser-search-engine';
const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', action: 'https://duckduckgo.com/', param: 'q' },
  google: { label: 'Google', action: 'https://www.google.com/search', param: 'q' },
  bing: { label: 'Bing', action: 'https://www.bing.com/search', param: 'q' },
  yahoo: { label: 'Yahoo', action: 'https://search.yahoo.com/search', param: 'p' },
  ecosia: { label: 'Ecosia', action: 'https://www.ecosia.org/search', param: 'q' },
  brave: { label: 'Brave Search', action: 'https://search.brave.com/search', param: 'q' },
};

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchEngineSelect = document.getElementById('search-engine-select');

for (const [id, engine] of Object.entries(SEARCH_ENGINES)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = engine.label;
  searchEngineSelect.appendChild(option);
}

function applySearchEngine(id) {
  const engine = SEARCH_ENGINES[id] || SEARCH_ENGINES.duckduckgo;
  searchForm.action = engine.action;
  searchInput.name = engine.param;
  searchInput.placeholder = 'Search ' + engine.label;
  searchEngineSelect.value = SEARCH_ENGINES[id] ? id : 'duckduckgo';
}

applySearchEngine(localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY) || 'duckduckgo');

searchEngineSelect.onchange = () => {
  localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, searchEngineSelect.value);
  applySearchEngine(searchEngineSelect.value);
};

const BG_STORAGE_KEY = 'shield-browser-background';
const DEFAULT_BG_SRC = '../shield-browser-16x9.png';

function loadBackground() {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    // Only a genuinely first launch (nothing in storage yet) falls through to
    // the bundled default -- an explicit "Remove background" still saves
    // src: null, and that stored null must stick, not get replaced back with
    // the default on the next load.
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to default
  }
  return { src: DEFAULT_BG_SRC, opacity: 30 };
}

let background = loadBackground();

function saveBackground() {
  try {
    localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(background));
  } catch {
    showBgError('Could not save that background (it may be too large to store).');
  }
}

const bgImageEl = document.getElementById('bg-image');
const bgUrlInput = document.getElementById('bg-url-input');
const bgUrlApply = document.getElementById('bg-url-apply');
const bgFileBtn = document.getElementById('bg-file-btn');
const bgFileInput = document.getElementById('bg-file-input');
const bgOpacity = document.getElementById('bg-opacity');
const bgRemoveBtn = document.getElementById('bg-remove-btn');
const bgError = document.getElementById('bg-error');

function showBgError(message) {
  bgError.textContent = message;
  bgError.classList.add('visible');
}

function clearBgError() {
  bgError.textContent = '';
  bgError.classList.remove('visible');
}

function renderBackground() {
  bgImageEl.style.backgroundImage = background.src ? `url("${background.src}")` : 'none';
  bgImageEl.style.opacity = background.opacity / 100;
  bgOpacity.value = background.opacity;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = src;
  });
}

// CSS `background-size: cover` (set in style.css) already scales the image
// so it fully covers the viewport with at least one dimension matching
// exactly, without distorting the aspect ratio -- that's the "cover"
// behavior asked for. The only thing left to enforce ourselves is rejecting
// images smaller than the screen in either dimension, since "covering" with
// an undersized image would mean upscaling it (blurry/pixelated) instead of
// downscaling.
function checkImageMeetsScreenResolution(img) {
  const screenW = window.screen.width;
  const screenH = window.screen.height;
  if (img.naturalWidth < screenW || img.naturalHeight < screenH) {
    return `Image is ${img.naturalWidth}×${img.naturalHeight}, smaller than your screen `
      + `(${screenW}×${screenH}). Choose a higher-resolution image.`;
  }
  return null;
}

async function setBackgroundFromSrc(src) {
  let img;
  try {
    img = await loadImage(src);
  } catch {
    showBgError('Could not load that image.');
    return;
  }
  const error = checkImageMeetsScreenResolution(img);
  if (error) {
    showBgError(error);
    return;
  }
  clearBgError();
  background.src = src;
  saveBackground();
  renderBackground();
}

bgUrlApply.onclick = () => {
  const url = bgUrlInput.value.trim();
  if (!url) return;
  setBackgroundFromSrc(url);
};
bgUrlInput.onkeydown = (e) => {
  if (e.key === 'Enter') bgUrlApply.click();
};

// Local files: a plain <input type="file"> needs no Electron-specific API
// and works fine in a sandboxed renderer. The chosen file is read as a data
// URL (rather than referenced by path) since a sandboxed renderer with no
// preload script has no access to the absolute filesystem path anyway.
bgFileBtn.onclick = () => bgFileInput.click();
bgFileInput.onchange = () => {
  const file = bgFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setBackgroundFromSrc(reader.result);
  reader.onerror = () => showBgError('Could not read that file.');
  reader.readAsDataURL(file);
};

bgOpacity.oninput = () => {
  background.opacity = Number(bgOpacity.value);
  bgImageEl.style.opacity = background.opacity / 100;
};
bgOpacity.onchange = () => saveBackground();

bgRemoveBtn.onclick = () => {
  background = { src: null, opacity: background.opacity };
  saveBackground();
  renderBackground();
  clearBgError();
};

renderBackground();

// Site whitelist/blacklist management (main-process-owned; see siteLists.js
// and main.js's webRequest gate). This UI only supports removing an entry
// (reverting it to "undecided", so it'll be asked about again next time) --
// there's no move-between-lists action to keep this to a minimal edit surface.
const whitelistListEl = document.getElementById('whitelist-list');
const blacklistListEl = document.getElementById('blacklist-list');

function renderSiteList(container, hostnames, onRemove) {
  container.innerHTML = '';
  if (hostnames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'site-list-empty';
    empty.textContent = 'Empty';
    container.appendChild(empty);
    return;
  }
  for (const hostname of hostnames.sort()) {
    const item = document.createElement('div');
    item.className = 'site-list-item';

    const label = document.createElement('span');
    label.textContent = hostname;
    label.title = hostname;
    item.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.onclick = () => onRemove(hostname);
    item.appendChild(removeBtn);

    container.appendChild(item);
  }
}

async function renderSiteLists() {
  const { whitelist, blacklist } = await window.siteListAPI.getLists();
  renderSiteList(whitelistListEl, whitelist, (hostname) => {
    window.siteListAPI.removeFromWhitelist(hostname);
    renderSiteLists();
  });
  renderSiteList(blacklistListEl, blacklist, (hostname) => {
    window.siteListAPI.removeFromBlacklist(hostname);
    renderSiteLists();
  });
}

renderSiteLists();
menuBtn.addEventListener('click', renderSiteLists); // refresh in case a popup decision landed elsewhere

// When a page you've linked to requests some brand-new site directly (not
// via a click you made yourself), main.js auto-whitelists it so it's
// reachable, then asks here whether to also add it as one of your own links
// -- offers are queued and shown one at a time so they never stack.
const offerQueue = [];
let processingOffers = false;

async function offerAddLink(hostname) {
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  groupOptions.push({ value: '__new__', label: '+ New group…' });
  const result = await showFormModal(
    `Add ${hostname} to your links?`,
    [{ name: 'groupId', label: 'Add to group', type: 'select', options: groupOptions }],
    { okLabel: 'Add', cancelLabel: 'Skip' }
  );
  if (!result) return;

  let groupId = result.groupId;
  if (groupId === '__new__') {
    const name = await showPrompt('New group name');
    if (!name) return;
    const newGroup = { id: uid(), name, sites: [] };
    groups.push(newGroup);
    groupId = newGroup.id;
  }
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.sites.push({ id: uid(), name: hostname, url: `https://${hostname}` });
  saveGroups();
  render();
}

async function processOfferQueue() {
  if (processingOffers) return;
  processingOffers = true;
  while (offerQueue.length) {
    // Don't stomp on a modal the user is already mid-interaction with
    // (e.g. manually adding a site) -- wait for it to free up.
    while (!modalOverlay.classList.contains('hidden')) {
      await new Promise((r) => setTimeout(r, 300));
    }
    await offerAddLink(offerQueue.shift());
  }
  processingOffers = false;
}

window.siteListAPI.onOfferAddLink((hostname) => {
  offerQueue.push(hostname);
  processOfferQueue();
});

// ---------------------------------------------------------------------------
// To-do list. Managed via its own modal (hamburger menu), not edit mode --
// this is a separate concern from the site-shortcut groups, though tasks
// reference those same groups as "sites needed to complete this task".
// ---------------------------------------------------------------------------

const TASKS_STORAGE_KEY = 'shield-browser-tasks';
const ACTIVE_TASK_STORAGE_KEY = 'shield-browser-active-task';

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to empty
  }
  return [];
}

let tasks = loadTasks();
let activeTaskId = localStorage.getItem(ACTIVE_TASK_STORAGE_KEY) || null;

function saveTasks() {
  localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
}

function saveActiveTaskId() {
  if (activeTaskId) localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, activeTaskId);
  else localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
}

// A single select value like "custom-days" <-> the stored {type, interval}
// shape, so "Daily"/"Weekly"/"Monthly" can be plain one-click options while
// "Every N ..." only needs one extra number field regardless of unit.
function encodeFrequency(freq) {
  if (freq.type === 'once') return 'once';
  if (freq.interval === 1) {
    if (freq.type === 'days') return 'daily';
    if (freq.type === 'weeks') return 'weekly';
    if (freq.type === 'months') return 'monthly';
  }
  return 'custom-' + freq.type;
}

function decodeFrequency(frequencyType, intervalStr) {
  const interval = Math.max(1, parseInt(intervalStr, 10) || 1);
  switch (frequencyType) {
    case 'once':
      return { type: 'once', interval: 1 };
    case 'daily':
      return { type: 'days', interval: 1 };
    case 'weekly':
      return { type: 'weeks', interval: 1 };
    case 'monthly':
      return { type: 'months', interval: 1 };
    case 'custom-days':
      return { type: 'days', interval };
    case 'custom-weeks':
      return { type: 'weeks', interval };
    case 'custom-months':
      return { type: 'months', interval };
    default:
      return { type: 'days', interval: 1 };
  }
}

function describeTaskSchedule(task) {
  const freqLabels = {
    once: 'Once',
    days: task.frequency.interval === 1 ? 'Daily' : `Every ${task.frequency.interval} days`,
    weeks: task.frequency.interval === 1 ? 'Weekly' : `Every ${task.frequency.interval} weeks`,
    months: task.frequency.interval === 1 ? 'Monthly' : `Every ${task.frequency.interval} months`,
  };
  return `${task.dueDate} ${task.dueTime} · ${freqLabels[task.frequency.type]}`;
}

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom-days', label: 'Every N days' },
  { value: 'custom-weeks', label: 'Every N weeks' },
  { value: 'custom-months', label: 'Every N months' },
];

async function openTaskForm(existingTask) {
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  const result = await showFormModal(
    existingTask ? 'Edit task' : 'Add task',
    [
      { name: 'name', label: 'Name', value: existingTask ? existingTask.name : '' },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        value: existingTask ? existingTask.description : '',
        required: false,
      },
      {
        name: 'dueDate',
        label: 'Due date',
        type: 'date',
        value: existingTask ? existingTask.dueDate : Recurrence.dateToISO(new Date()),
      },
      { name: 'dueTime', label: 'Due time', type: 'time', value: existingTask ? existingTask.dueTime : '18:00' },
      {
        name: 'frequencyType',
        label: 'Repeats',
        type: 'select',
        value: existingTask ? encodeFrequency(existingTask.frequency) : 'once',
        options: FREQUENCY_OPTIONS,
      },
      {
        name: 'interval',
        label: 'N (only used for "Every N ..." above)',
        value: existingTask ? String(existingTask.frequency.interval || 1) : '1',
        required: false,
      },
      {
        name: 'groupIds',
        label: 'Sites needed for this task',
        type: 'checkboxes',
        value: existingTask ? existingTask.groupIds : [],
        options: groupOptions,
        required: false,
      },
    ],
    { okLabel: existingTask ? 'Save' : 'Add' }
  );
  if (!result) return;

  const frequency = decodeFrequency(result.frequencyType, result.interval);
  if (existingTask) {
    existingTask.name = result.name;
    existingTask.description = result.description;
    existingTask.dueDate = result.dueDate;
    existingTask.dueTime = result.dueTime;
    existingTask.frequency = frequency;
    existingTask.groupIds = result.groupIds;
  } else {
    tasks.push({
      id: uid(),
      name: result.name,
      description: result.description,
      dueDate: result.dueDate,
      dueTime: result.dueTime,
      frequency,
      groupIds: result.groupIds,
      completions: {},
    });
  }
  saveTasks();
  renderTodo();
  renderTodoManageList();
}

function deleteTask(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!confirm(`Delete task "${task.name}"?`)) return;
  tasks = tasks.filter((t) => t.id !== taskId);
  if (activeTaskId === taskId) {
    activeTaskId = null;
    saveActiveTaskId();
  }
  saveTasks();
  renderTodo();
  renderTodoManageList();
}

function toggleTaskCompletion(task, occurrenceDate) {
  if (task.completions[occurrenceDate]) delete task.completions[occurrenceDate];
  else task.completions[occurrenceDate] = true;
  saveTasks();
  renderTodo();
}

// One item per task: its most recent due-or-earlier occurrence (carried
// forward if still incomplete, so a missed day doesn't just vanish), plus --
// after 6pm local time -- a preview item for tomorrow's occurrence if it has
// one, shown regardless of today's status.
function computeTodoDisplayItems() {
  const now = new Date();
  const todayISO = Recurrence.dateToISO(now);
  const items = [];

  for (const task of tasks) {
    const recentDate = Recurrence.mostRecentOccurrenceOnOrBefore(task, todayISO);
    if (recentDate) {
      const completed = !!task.completions[recentDate];
      const overdue = !completed && Recurrence.isOverdue(task, recentDate, now);
      items.push({
        task,
        occurrenceDate: recentDate,
        completed,
        overdue,
        kind: recentDate === todayISO ? 'today' : 'carried-over',
      });
    }
  }

  if (now.getHours() >= 18) {
    const tomorrowISO = Recurrence.dateToISO(Recurrence.addDays(now, 1));
    for (const task of tasks) {
      if (Recurrence.occursOn(task, tomorrowISO)) {
        items.push({ task, occurrenceDate: tomorrowISO, completed: false, overdue: false, kind: 'tomorrow' });
      }
    }
  }

  return items;
}

function hasOverdueIncompleteTask() {
  return computeTodoDisplayItems().some((item) => item.overdue && !item.completed);
}

function taskAllowedHostnames(task) {
  return (task.groupIds || [])
    .flatMap((gid) => (groups.find((g) => g.id === gid)?.sites || []).map((s) => hostnameOf(s.url)))
    .filter(Boolean);
}

// Mirrors the pending/overdue state to main.js: null = browse normally, [] =
// total lockdown (multiple tasks overdue, none chosen yet), [...] = only the
// active task's sites are reachable. See main.js's focusModeHosts.
function updateFocusMode(pendingOverdue) {
  if (pendingOverdue.length === 0) {
    window.siteListAPI.setFocusMode(null);
    return;
  }
  if (!activeTaskId) {
    window.siteListAPI.setFocusMode([]);
    return;
  }
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  window.siteListAPI.setFocusMode(activeTask ? taskAllowedHostnames(activeTask) : []);
}

const todoSectionEl = document.getElementById('todo-section');
const todoListEl = document.getElementById('todo-list');
const todoViewportEl = document.getElementById('todo-viewport');
const todoScrollUpBtn = document.getElementById('todo-scroll-up');
const todoScrollDownBtn = document.getElementById('todo-scroll-down');

// Same up/down-by-one-row approach as the link groups (#groups-viewport),
// except a "row" here is trivially one task -- to-dos are a single column,
// not a wrapping grid -- so there's no gap to account for, just the item's
// own height.
function updateTodoScrollButtons() {
  const overflowing = todoViewportEl.scrollHeight > todoViewportEl.clientHeight + 1;
  todoScrollUpBtn.classList.toggle('visible', overflowing);
  todoScrollDownBtn.classList.toggle('visible', overflowing);
  if (!overflowing) return;
  todoScrollUpBtn.disabled = todoViewportEl.scrollTop <= 0;
  todoScrollDownBtn.disabled = todoViewportEl.scrollTop >= todoViewportEl.scrollHeight - todoViewportEl.clientHeight - 1;
}

function todoRowStep() {
  const firstItem = todoListEl.querySelector('.todo-item');
  return firstItem ? firstItem.getBoundingClientRect().height : todoViewportEl.clientHeight;
}

todoScrollUpBtn.onclick = () => todoViewportEl.scrollBy({ top: -todoRowStep(), behavior: 'smooth' });
todoScrollDownBtn.onclick = () => todoViewportEl.scrollBy({ top: todoRowStep(), behavior: 'smooth' });
todoViewportEl.addEventListener('scroll', updateTodoScrollButtons);
window.addEventListener('resize', updateTodoScrollButtons);

function renderTodoEmptyState() {
  todoListEl.innerHTML = '';

  const message = document.createElement('div');
  message.className = 'empty-state';
  message.textContent = 'You have no to-dos yet.';
  todoListEl.appendChild(message);

  const btn = document.createElement('button');
  btn.className = 'accent-btn';
  btn.textContent = '+ Add task';
  btn.onclick = () => openTaskForm(null);
  todoListEl.appendChild(btn);
}

function renderTodo() {
  if (tasks.length === 0) {
    todoSectionEl.classList.remove('hidden');
    renderTodoEmptyState();
    updateFocusMode([]);
    updateTodoScrollButtons();
    return;
  }

  const items = computeTodoDisplayItems();

  if (items.length === 0) {
    todoSectionEl.classList.add('hidden');
    todoListEl.innerHTML = '';
    updateFocusMode([]);
    return;
  }
  todoSectionEl.classList.remove('hidden');

  const pendingOverdue = items.filter((item) => item.overdue && !item.completed);
  if (pendingOverdue.length === 1) {
    activeTaskId = pendingOverdue[0].task.id; // only one candidate, no need to ask
  } else if (pendingOverdue.length === 0 || !pendingOverdue.some((item) => item.task.id === activeTaskId)) {
    activeTaskId = null; // nothing pending, or the previously-active task no longer is -- ask again
  }
  saveActiveTaskId();

  todoListEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className =
      'todo-item' + (item.completed ? ' completed' : '') + (item.task.id === activeTaskId ? ' active' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.completed;
    checkbox.disabled = item.kind === 'tomorrow';
    checkbox.onclick = (e) => {
      e.stopPropagation();
      toggleTaskCompletion(item.task, item.occurrenceDate);
    };
    row.appendChild(checkbox);

    const text = document.createElement('div');
    text.className = 'todo-item-text';

    const name = document.createElement('div');
    name.className = 'todo-item-name';
    name.textContent = item.task.name;
    text.appendChild(name);

    if (item.task.description) {
      const desc = document.createElement('div');
      desc.className = 'todo-item-desc';
      desc.textContent = item.task.description;
      text.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'todo-item-meta' + (item.overdue && !item.completed ? ' overdue' : '');
    meta.textContent =
      item.kind === 'tomorrow'
        ? `Tomorrow, ${item.task.dueTime}`
        : item.overdue && !item.completed
          ? `Overdue since ${item.occurrenceDate} ${item.task.dueTime}`
          : `Due ${item.task.dueTime}`;
    text.appendChild(meta);

    row.appendChild(text);

    if (pendingOverdue.length > 1 && pendingOverdue.some((i) => i.task.id === item.task.id)) {
      row.title = 'Click to work on this task now';
      row.onclick = () => {
        activeTaskId = item.task.id;
        saveActiveTaskId();
        renderTodo();
      };
    }

    todoListEl.appendChild(row);
  }

  updateFocusMode(pendingOverdue);
  updateTodoScrollButtons();
}

const todoManageOverlay = document.getElementById('todo-manage-overlay');
const todoManageListEl = document.getElementById('todo-manage-list');

function renderTodoManageList() {
  todoManageListEl.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'todo-manage-empty';
    empty.textContent = 'No tasks yet.';
    todoManageListEl.appendChild(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'todo-manage-item';

    const info = document.createElement('div');
    info.className = 'todo-manage-item-info';
    const name = document.createElement('div');
    name.className = 'todo-manage-item-name';
    name.textContent = task.name;
    info.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'todo-manage-item-meta';
    meta.textContent = describeTaskSchedule(task);
    info.appendChild(meta);
    row.appendChild(info);

    const editBtn = document.createElement('button');
    editBtn.title = 'Edit';
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    editBtn.onclick = () => openTaskForm(task);
    row.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    deleteBtn.onclick = () => deleteTask(task.id);
    row.appendChild(deleteBtn);

    todoManageListEl.appendChild(row);
  }
}

document.getElementById('todo-manage-btn').onclick = () => {
  menuDropdown.classList.add('hidden');
  renderTodoManageList();
  todoManageOverlay.classList.remove('hidden');
};
document.getElementById('todo-manage-close').onclick = () => todoManageOverlay.classList.add('hidden');
document.getElementById('todo-add-btn').onclick = () => openTaskForm(null);

// render() (groups) must run before renderTodo(): .todo-section's flex-based
// height depends on #groups-viewport's height already being finalized (set
// by updateGroupsLayout() inside render()) -- calling renderTodo() first
// would measure the todo viewport's available space before groups claim
// theirs, understating how much actually overflows.
render();

renderTodo();
setInterval(renderTodo, 30000); // catches a task crossing its due time without needing user interaction
