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
      return {
        getValue,
        name: field.name,
        required: field.required !== false,
        isArray: field.type === 'checkboxes',
        wrap,
        showIf: field.showIf,
      };
    });

    // Fields with a `showIf(values)` predicate (e.g. a monthly-only option
    // that's irrelevant unless "Repeats" is set to monthly) are hidden/shown
    // as any field changes, rather than always showing every field
    // regardless of the current selection. A hidden field's own
    // required-ness is ignored on submit, but its value is still included in
    // the result -- so switching frequency back and forth doesn't lose
    // whatever was entered in a temporarily-hidden field.
    function currentValues() {
      const values = {};
      for (const f of fieldGetters) values[f.name] = f.getValue();
      return values;
    }

    function updateVisibility() {
      if (!fieldGetters.some((f) => f.showIf)) return; // no conditional fields, skip the work
      const values = currentValues();
      for (const f of fieldGetters) {
        if (f.showIf) f.wrap.classList.toggle('modal-field-hidden', !f.showIf(values));
      }
    }

    modalOverlay.classList.remove('hidden');
    interactiveEls[0].focus();
    if (interactiveEls[0].select) interactiveEls[0].select();
    updateVisibility();

    function finish(result) {
      modalOverlay.classList.add('hidden');
      modalOk.onclick = null;
      modalCancel.onclick = null;
      interactiveEls.forEach((el) => {
        el.onkeydown = null;
        el.onchange = null;
        el.oninput = null;
      });
      resolve(result);
    }

    function submit() {
      const result = {};
      for (const f of fieldGetters) {
        const value = f.getValue();
        const visible = !f.wrap.classList.contains('modal-field-hidden');
        if (visible && f.required && (f.isArray ? value.length === 0 : !value)) return;
        result[f.name] = value;
      }
      finish(result);
    }

    modalOk.onclick = submit;
    modalCancel.onclick = () => finish(null);
    interactiveEls.forEach((el) => {
      el.onchange = updateVisibility;
      el.oninput = updateVisibility;
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

// Wires native HTML5 drag-and-drop reordering onto el, live-reordering DOM
// siblings as the drag passes over them and committing the new order (via
// commitOrder) once the gesture ends. dragState is a plain
// {el, rafId, pendingX, pendingTarget} object shared by every reorderable
// item in the same list -- use a *separate* dragState per independent list
// (one for the groups strip, one per group's own sites) so a drag in one
// list is never mistaken for, or reorders, a different list. Only active
// while edit mode is on.
function makeDraggable(el, dragState, commitOrder) {
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    if (!document.body.classList.contains('edit-mode')) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    dragState.el = el;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // some browsers require data to be set for the drag to start
    el.classList.add('dragging');
  });

  el.addEventListener('dragover', (e) => {
    if (!dragState.el) return;
    e.preventDefault(); // allow a drop here
    // Stop this *before* the "hovering the dragged element itself" check
    // below, not after -- otherwise, once the dragged element slides under
    // the cursor (which it does right after a reposition), this event would
    // fall through unstopped to the container-level dragover fallback
    // (makeDropContainer), which would then yank it straight to the end of
    // the list. That silently undid every reposition the instant it
    // happened, one frame later, alternating endlessly between the two.
    e.stopPropagation();
    if (dragState.el === el) return; // hovering the dragged element itself -- nothing to reposition
    // dragover can fire dozens of times a second; reacting to every one of
    // them moved the dragged element mid-burst, which shifted this target's
    // layout out from under the cursor and made the *next* event in the same
    // burst read stale/conflicting geometry -- flip-flopping the element
    // back and forth as visible flicker. Collapse a whole burst down to at
    // most one reposition per animation frame instead.
    dragState.pendingX = e.clientX;
    dragState.pendingTarget = el;
    if (dragState.rafId) return;
    dragState.rafId = requestAnimationFrame(() => {
      dragState.rafId = null;
      const target = dragState.pendingTarget;
      if (!dragState.el || !target) return;
      const rect = target.getBoundingClientRect();
      const before = dragState.pendingX < rect.left + rect.width / 2;
      const wantsNextSibling = before ? target : target.nextSibling;
      if (dragState.el.nextSibling === wantsNextSibling) return; // already there -- skip the no-op move that would otherwise re-trigger a reflow every frame
      target.parentNode.insertBefore(dragState.el, wantsNextSibling);
    });
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  el.addEventListener('dragend', (e) => {
    e.stopPropagation();
    el.classList.remove('dragging');
    if (dragState.rafId) {
      cancelAnimationFrame(dragState.rafId);
      dragState.rafId = null;
    }
    if (dragState.el) {
      dragState.el = null;
      commitOrder();
    }
  });
}

// Lets dragging into empty space past the last item (rather than needing to
// hover directly over another item) still append the dragged item at the
// end of the list -- beforeEl is the container's trailing non-reorderable
// element to insert ahead of (the "+ Add site" tile), or omitted to just
// append at the very end (the groups strip has no such trailing element).
function makeDropContainer(containerEl, dragState, beforeEl) {
  containerEl.addEventListener('dragover', (e) => {
    if (!dragState.el) return;
    e.preventDefault();
    if (dragState.el.nextSibling === (beforeEl || null)) return; // already last -- skip the no-op move
    containerEl.insertBefore(dragState.el, beforeEl || null);
  });
}

// While a drag is over one of the up/down scroll-arrow buttons, repeatedly
// nudges viewportEl in that direction so an item can be dragged into a
// group/row that's currently scrolled out of view, instead of being stuck
// unreachable at the edge of the visible page.
function makeAutoScrollZone(zoneEl, viewportEl, direction, dragState) {
  let intervalId = null;
  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
  zoneEl.addEventListener('dragenter', (e) => {
    if (!dragState.el) return;
    e.preventDefault();
    if (intervalId) return;
    intervalId = setInterval(() => viewportEl.scrollBy({ top: direction * 8 }), 40);
  });
  zoneEl.addEventListener('dragover', (e) => {
    if (dragState.el) e.preventDefault(); // keep signaling "drop allowed" so dragleave doesn't fire spuriously
  });
  zoneEl.addEventListener('dragleave', stop);
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    stop();
  });
}

const groupDragState = { el: null };

function reorderGroupsFromDOM() {
  const orderedIds = [...groupsEl.querySelectorAll(':scope > .group')].map((el) => el.dataset.groupId);
  groups.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  // render() rebuilds every group card from scratch, which would otherwise
  // silently reset the strip's scroll position back to the top -- jarring
  // if you'd scrolled down to reach the group you just dropped.
  const scrollTop = groupsViewportEl.scrollTop;
  saveGroups();
  render();
  groupsViewportEl.scrollTop = scrollTop;
  updateGroupsScrollButtons();
}

function reorderSitesFromDOM(group, sitesEl) {
  const orderedIds = [...sitesEl.querySelectorAll('.site-tile')].map((el) => el.dataset.siteId);
  group.sites.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  // Same reasoning as reorderGroupsFromDOM: preserve this group's own
  // sites-viewport scroll position across the render() that follows.
  const scrollTop = sitesEl.parentElement.scrollTop;
  saveGroups();
  render();
  const newViewport = groupsEl.querySelector(`.group[data-group-id="${group.id}"] .sites-viewport`);
  if (newViewport) newViewport.scrollTop = scrollTop;
}

makeDropContainer(groupsEl, groupDragState);

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
  el.dataset.groupId = group.id;
  makeDraggable(el, groupDragState, reorderGroupsFromDOM);

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
  const siteDragState = { el: null };

  const scrollUpBtn = document.createElement('button');
  scrollUpBtn.className = 'sites-scroll-btn sites-scroll-up';
  scrollUpBtn.textContent = '⌃';
  scrollUpBtn.title = 'Previous 4';
  el.appendChild(scrollUpBtn);

  const viewport = document.createElement('div');
  viewport.className = 'sites-viewport';

  const sitesEl = document.createElement('div');
  sitesEl.className = 'sites';
  for (const site of group.sites) {
    const tile = renderSite(group.id, site);
    makeDraggable(tile, siteDragState, () => reorderSitesFromDOM(group, sitesEl));
    sitesEl.appendChild(tile);
  }
  const addTile = renderAddSiteTile(group.id);
  sitesEl.appendChild(addTile);
  makeDropContainer(sitesEl, siteDragState, addTile);
  viewport.appendChild(sitesEl);
  el.appendChild(viewport);

  const scrollDownBtn = document.createElement('button');
  scrollDownBtn.className = 'sites-scroll-btn sites-scroll-down';
  scrollDownBtn.textContent = '⌄';
  scrollDownBtn.title = 'Next 4';
  el.appendChild(scrollDownBtn);

  makeAutoScrollZone(scrollUpBtn, viewport, -1, siteDragState);
  makeAutoScrollZone(scrollDownBtn, viewport, 1, siteDragState);

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
  a.dataset.siteId = site.id;
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
  if (await window.siteListAPI.isBlockedByDefault(hostnameOf(siteUrl))) {
    alert('This site is blocked by default (ads/social) and can\'t be added as a link.');
    return;
  }
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
  if (await window.siteListAPI.isBlockedByDefault(hostnameOf(siteUrl))) {
    alert('This site is blocked by default (ads/social) and can\'t be added as a link.');
    return;
  }
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
makeAutoScrollZone(groupsScrollUpBtn, groupsViewportEl, -1, groupDragState);
makeAutoScrollZone(groupsScrollDownBtn, groupsViewportEl, 1, groupDragState);
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
// and main.js's webRequest gate), edited via its own modal (hamburger menu)
// rather than previewed inline -- supports adding a hostname directly to
// either list, not just removing entries that got added automatically.
// Whitelist entries also get a "move to blacklist" button (blacklisting
// already implies removal from the whitelist, via siteLists.addToBlacklist),
// deliberately one-directional -- there's no matching "move to whitelist" on
// blacklist entries, since re-allowing a deliberately blocked site is a
// bigger decision than reusing this one-click shortcut for.
const whitelistListEl = document.getElementById('whitelist-list');
const blacklistListEl = document.getElementById('blacklist-list');
const siteListsOverlay = document.getElementById('site-lists-overlay');
const whitelistAddBtn = document.getElementById('whitelist-add-btn');
const blacklistAddBtn = document.getElementById('blacklist-add-btn');

function renderSiteList(container, hostnames, onRemove, onMove) {
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

    if (onMove) {
      const moveBtn = document.createElement('button');
      moveBtn.textContent = '→';
      moveBtn.title = 'Move to blacklist';
      moveBtn.onclick = () => onMove(hostname);
      item.appendChild(moveBtn);
    }

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
  renderSiteList(
    whitelistListEl,
    whitelist,
    (hostname) => {
      window.siteListAPI.removeFromWhitelist(hostname);
      renderSiteLists();
    },
    (hostname) => {
      window.siteListAPI.blacklistHost(hostname);
      renderSiteLists();
    }
  );
  renderSiteList(blacklistListEl, blacklist, (hostname) => {
    window.siteListAPI.removeFromBlacklist(hostname);
    renderSiteLists();
  });
}

async function addHostnameTo(action, title, guardBlocked) {
  const input = await showPrompt(title);
  if (!input) return;
  const url = normalizeUrl(input);
  const hostname = url && hostnameOf(url);
  if (!hostname) return;
  // Only the whitelist side needs this check -- a social/ad domain is
  // blocked unconditionally regardless of the whitelist (see main.js's
  // installNetworkBlocking), so whitelisting one would be a misleading
  // no-op; blacklisting one is redundant but not misleading, so it's left
  // allowed.
  if (guardBlocked && (await window.siteListAPI.isBlockedByDefault(hostname))) {
    alert('This site is blocked by default (ads/social) and can\'t be added to the whitelist.');
    return;
  }
  action(hostname);
  renderSiteLists();
}

whitelistAddBtn.onclick = () =>
  addHostnameTo((hostname) => window.siteListAPI.whitelistHost(hostname), 'Add to whitelist', true);
blacklistAddBtn.onclick = () => addHostnameTo((hostname) => window.siteListAPI.blacklistHost(hostname), 'Add to blacklist');

document.getElementById('site-lists-manage-btn').onclick = () => {
  menuDropdown.classList.add('hidden');
  renderSiteLists(); // refresh in case a popup decision (Allow/Disallow) landed elsewhere since it was last open
  siteListsOverlay.classList.remove('hidden');
};
document.getElementById('site-lists-close').onclick = () => siteListsOverlay.classList.add('hidden');

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

// `extra` carries the task form's weekly/monthly sub-fields (weekdays,
// monthlyMode, monthlyOffset, monthlyWeekday, monthlyOrdinal) -- folded into
// the decoded frequency only when they're actually relevant to the chosen
// type, so e.g. leftover monthly fields from switching frequencyType back
// and forth don't leak into a plain weekly/daily task.
function decodeFrequency(frequencyType, intervalStr, extra = {}) {
  const interval = Math.max(1, parseInt(intervalStr, 10) || 1);
  const base = (() => {
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
  })();

  if (base.type === 'weeks' && extra.weekdays && extra.weekdays.length > 0) {
    base.weekdays = extra.weekdays.map(Number).sort((a, b) => a - b);
  }
  if (base.type === 'months' && extra.monthlyMode && extra.monthlyMode !== 'day') {
    base.dayMode = extra.monthlyMode;
    if (extra.monthlyMode === 'before-last') {
      base.offset = Math.min(3, Math.max(0, parseInt(extra.monthlyOffset, 10) || 0));
    } else if (extra.monthlyMode === 'weekday') {
      base.weekday = Number(extra.monthlyWeekday);
      base.ordinal = extra.monthlyOrdinal === 'last' ? 'last' : parseInt(extra.monthlyOrdinal, 10);
    }
  }
  return base;
}

const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDINAL_LABELS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', last: 'last' };

function describeTaskSchedule(task) {
  const freq = task.frequency;
  let label;
  if (freq.type === 'once') {
    label = 'Once';
  } else if (freq.type === 'days') {
    label = freq.interval === 1 ? 'Daily' : `Every ${freq.interval} days`;
  } else if (freq.type === 'weeks') {
    const base = freq.interval === 1 ? 'Weekly' : `Every ${freq.interval} weeks`;
    label =
      freq.weekdays && freq.weekdays.length > 0
        ? `${base} on ${freq.weekdays.map((d) => WEEKDAY_SHORT_NAMES[d]).join('/')}`
        : base;
  } else if (freq.type === 'months') {
    const base = freq.interval === 1 ? 'Monthly' : `Every ${freq.interval} months`;
    if (freq.dayMode === 'last') {
      label = `${base}, last day`;
    } else if (freq.dayMode === 'before-last') {
      label = freq.offset === 0 ? `${base}, last day` : `${base}, ${freq.offset} day(s) before last`;
    } else if (freq.dayMode === 'weekday') {
      label = `${base}, ${ORDINAL_LABELS[freq.ordinal]} ${WEEKDAY_SHORT_NAMES[freq.weekday]}`;
    } else {
      label = base;
    }
  } else {
    label = '';
  }
  const scheduleBase = `${task.dueDate} ${task.allDay ? 'all day' : task.dueTime} · ${label}`;
  return task.endDate ? `${scheduleBase} until ${task.endDate}` : scheduleBase;
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

const WEEKDAY_CHECKBOX_OPTIONS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
];

const WEEKDAY_SELECT_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
];

const MONTHLY_MODE_OPTIONS = [
  { value: 'day', label: 'Same day of month as due date' },
  { value: 'last', label: 'Last day of month' },
  { value: 'before-last', label: 'N days before last day of month' },
  { value: 'weekday', label: 'Nth weekday of month' },
];

const ORDINAL_OPTIONS = [
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd' },
  { value: '4', label: '4th' },
  { value: '5', label: '5th' },
  { value: 'last', label: 'Last' },
];

const isWeeklyFrequencyType = (frequencyType) => frequencyType === 'weekly' || frequencyType === 'custom-weeks';
const isMonthlyFrequencyType = (frequencyType) => frequencyType === 'monthly' || frequencyType === 'custom-months';

// `splitContext` (only ever set together with an existingTask) is
// `{ occurrenceDate, scope }` -- present when editing a recurring task via
// the "only this occurrence" / "this and following occurrences" choice (see
// showEditScopeChoice below), rather than the whole series in place. It
// changes the modal's title and, on save, routes to applySplitEdit() instead
// of mutating existingTask directly. The due date shown/edited is the
// specific occurrence being split off, not the series' original anchor date.
async function openTaskForm(existingTask, splitContext) {
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  const formTitle = splitContext
    ? splitContext.scope === 'instance'
      ? 'Edit this occurrence'
      : 'Edit this and following occurrences'
    : existingTask
      ? 'Edit task'
      : 'Add task';
  const formDueDate = splitContext
    ? splitContext.occurrenceDate
    : existingTask
      ? existingTask.dueDate
      : Recurrence.dateToISO(new Date());
  const result = await showFormModal(
    formTitle,
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
        value: formDueDate,
      },
      {
        name: 'allDay',
        label: '',
        type: 'checkboxes',
        value: existingTask && existingTask.allDay ? ['allDay'] : [],
        options: [{ value: 'allDay', label: 'All day (no specific time)' }],
        required: false,
      },
      {
        name: 'dueTime',
        label: 'Due time',
        type: 'time',
        value: existingTask ? existingTask.dueTime || '18:00' : '18:00',
        showIf: (v) => v.allDay.length === 0,
      },
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
        name: 'weekdays',
        label: "Also recur on these days (weekly only; leave blank to just use the due date's weekday)",
        type: 'checkboxes',
        value: existingTask && existingTask.frequency.weekdays ? existingTask.frequency.weekdays.map(String) : [],
        options: WEEKDAY_CHECKBOX_OPTIONS,
        required: false,
        showIf: (v) => isWeeklyFrequencyType(v.frequencyType),
      },
      {
        name: 'monthlyMode',
        label: 'Monthly pattern',
        type: 'select',
        value: existingTask ? existingTask.frequency.dayMode || 'day' : 'day',
        options: MONTHLY_MODE_OPTIONS,
        showIf: (v) => isMonthlyFrequencyType(v.frequencyType),
      },
      {
        name: 'monthlyOffset',
        label: 'Days before last day of month (0-3)',
        value: existingTask && existingTask.frequency.offset != null ? String(existingTask.frequency.offset) : '0',
        required: false,
        showIf: (v) => isMonthlyFrequencyType(v.frequencyType) && v.monthlyMode === 'before-last',
      },
      {
        name: 'monthlyWeekday',
        label: 'Day of week',
        type: 'select',
        value: existingTask && existingTask.frequency.weekday != null ? String(existingTask.frequency.weekday) : '1',
        options: WEEKDAY_SELECT_OPTIONS,
        showIf: (v) => isMonthlyFrequencyType(v.frequencyType) && v.monthlyMode === 'weekday',
      },
      {
        name: 'monthlyOrdinal',
        label: 'Which occurrence',
        type: 'select',
        value: existingTask && existingTask.frequency.ordinal != null ? String(existingTask.frequency.ordinal) : '1',
        options: ORDINAL_OPTIONS,
        showIf: (v) => isMonthlyFrequencyType(v.frequencyType) && v.monthlyMode === 'weekday',
      },
      {
        name: 'endDate',
        label: 'End date (optional, recurring tasks only -- last recurrence on or before this date)',
        type: 'date',
        value: existingTask && existingTask.endDate ? existingTask.endDate : '',
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

  const endDate = result.endDate || null;
  if (endDate && endDate < result.dueDate) {
    alert('End date can\'t be before the due date.');
    return;
  }

  const allDay = result.allDay.length > 0;
  const dueTime = allDay ? null : result.dueTime;
  const frequency = decodeFrequency(result.frequencyType, result.interval, result);
  if (splitContext) {
    applySplitEdit(existingTask, {
      originalOccurrenceDate: splitContext.occurrenceDate,
      newOccurrenceDate: result.dueDate,
      scope: splitContext.scope,
    }, {
      name: result.name,
      description: result.description,
      dueTime,
      allDay,
      frequency,
      endDate,
      groupIds: result.groupIds,
    });
  } else if (existingTask) {
    existingTask.name = result.name;
    existingTask.description = result.description;
    existingTask.dueDate = result.dueDate;
    existingTask.dueTime = dueTime;
    existingTask.allDay = allDay;
    existingTask.frequency = frequency;
    existingTask.endDate = endDate;
    existingTask.groupIds = result.groupIds;
  } else {
    tasks.push({
      id: uid(),
      name: result.name,
      description: result.description,
      dueDate: result.dueDate,
      dueTime,
      allDay,
      endDate,
      frequency,
      groupIds: result.groupIds,
      completions: {},
    });
  }
  saveTasks();
  renderTodo();
  renderTodoManageList();
}

// Splits a recurring task's series around newOccurrenceDate -- the split
// point, which is normally the occurrence that was double-clicked
// (originalOccurrenceDate) but becomes wherever the user retargeted the
// "Due date" field to in the edit form, if they changed it. scope:
//  - 'instance': the historical portion ends at the occurrence just before
//    this one (or is dropped entirely if this was the series' very first
//    occurrence -- nothing historical to keep). This occurrence becomes its
//    own standalone 'once' task carrying the edits. The rest of the
//    ORIGINAL series (its own unedited settings) continues, starting at the
//    next occurrence after this one.
//  - 'following': the historical portion ends the same way, but a single new
//    task with the EDITED settings takes over starting at this occurrence
//    (no separate "original settings continue" task -- there's nothing left
//    of the old pattern after this point).
function applySplitEdit(originalTask, { originalOccurrenceDate, newOccurrenceDate, scope }, edited) {
  const originalCompletions = originalTask.completions || {};
  const originalEndDate = originalTask.endDate || null;
  const wasOriginalOccurrenceDone = !!originalCompletions[originalOccurrenceDate];
  const prevDate = Recurrence.previousOccurrenceBefore(originalTask, newOccurrenceDate);
  const nextDate = Recurrence.nextOccurrenceAfter(originalTask, newOccurrenceDate);

  if (prevDate) {
    originalTask.endDate = prevDate; // truncate the historical portion to end right before this occurrence
    // Once split off, the historical portion can never advance past this
    // fixed end date -- if its last occurrence were left incomplete, it
    // would show as a perpetually "carried over" overdue item with no
    // future occurrence to ever replace it. Mark whatever's already in the
    // past as done; anything on/after today hasn't happened yet.
    markPastOccurrencesDone(originalTask, Recurrence.dateToISO(new Date()));
  } else {
    tasks = tasks.filter((t) => t.id !== originalTask.id); // this was the series' very first occurrence -- nothing historical to keep
  }

  if (scope === 'instance') {
    tasks.push({
      id: uid(),
      name: edited.name,
      description: edited.description,
      dueDate: newOccurrenceDate,
      dueTime: edited.dueTime,
      allDay: edited.allDay,
      frequency: { type: 'once', interval: 1 },
      endDate: null,
      groupIds: edited.groupIds,
      completions: wasOriginalOccurrenceDone ? { [newOccurrenceDate]: true } : {},
    });

    if (nextDate) {
      tasks.push({
        id: uid(),
        name: originalTask.name,
        description: originalTask.description,
        dueDate: nextDate,
        dueTime: originalTask.dueTime,
        allDay: originalTask.allDay,
        frequency: originalTask.frequency,
        endDate: originalEndDate,
        groupIds: originalTask.groupIds,
        completions: { ...originalCompletions },
      });
    }
  } else if (scope === 'following') {
    tasks.push({
      id: uid(),
      name: edited.name,
      description: edited.description,
      dueDate: newOccurrenceDate,
      dueTime: edited.dueTime,
      allDay: edited.allDay,
      frequency: edited.frequency,
      endDate: edited.endDate,
      groupIds: edited.groupIds,
      completions: {
        ...originalCompletions,
        ...(wasOriginalOccurrenceDone ? { [newOccurrenceDate]: true } : {}),
      },
    });
  }
}

// Marks every occurrence of task strictly before todayISO as complete --
// used right after truncating a split-off historical task to a fixed end
// date, so it doesn't linger as an incomplete "carried over" item forever.
function markPastOccurrencesDone(task, todayISO) {
  const yesterdayISO = Recurrence.dateToISO(Recurrence.addDays(new Date(todayISO + 'T00:00:00'), -1));
  let cursor = task.dueDate;
  for (let i = 0; i < 3660 && cursor <= yesterdayISO; i++) {
    if (Recurrence.occursOn(task, cursor)) task.completions[cursor] = true;
    cursor = Recurrence.dateToISO(Recurrence.addDays(new Date(cursor + 'T00:00:00'), 1));
  }
}

const editScopeOverlay = document.getElementById('edit-scope-overlay');

// Resolves 'instance' | 'following' | 'all' | null (cancelled). Only shown
// for recurring tasks -- a 'once' task has nothing to split, so its
// double-click skips straight to editing it.
function showEditScopeChoice() {
  return new Promise((resolve) => {
    editScopeOverlay.classList.remove('hidden');
    const instanceBtn = document.getElementById('edit-scope-instance');
    const followingBtn = document.getElementById('edit-scope-following');
    const allBtn = document.getElementById('edit-scope-all');
    const cancelBtn = document.getElementById('edit-scope-cancel');

    function finish(choice) {
      editScopeOverlay.classList.add('hidden');
      instanceBtn.onclick = null;
      followingBtn.onclick = null;
      allBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(choice);
    }

    instanceBtn.onclick = () => finish('instance');
    followingBtn.onclick = () => finish('following');
    allBtn.onclick = () => finish('all');
    cancelBtn.onclick = () => finish(null);
  });
}

function deleteTask(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
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

// "Next recurrence" view: one entry per task for whatever's next -- its
// current pending occurrence (today/carried-over, same as the "pending"
// view) if there is one, otherwise the occurrence after it (once today's is
// completed, or before its very first one if it hasn't started yet). A task
// that occurs tomorrow still gets a separate preview there after 6pm even
// when today's is still pending, same as the "pending" view -- deduped
// against whatever's already been added for that date, so it doesn't show
// twice once today's occurrence is actually completed.
function computeNextRecurrenceItems() {
  const now = new Date();
  const todayISO = Recurrence.dateToISO(now);
  const tomorrowISO = Recurrence.dateToISO(Recurrence.addDays(now, 1));
  const items = [];

  for (const task of tasks) {
    const recentDate = Recurrence.mostRecentOccurrenceOnOrBefore(task, todayISO);
    if (recentDate && !task.completions[recentDate]) {
      items.push({
        task,
        occurrenceDate: recentDate,
        completed: false,
        overdue: Recurrence.isOverdue(task, recentDate, now),
        kind: recentDate === todayISO ? 'today' : 'carried-over',
      });
    } else {
      // Today's occurrence, if that's what just got completed, still shows
      // (crossed out) alongside whatever's next -- confirms what was just
      // checked off without it just vanishing. Not done for older completed
      // carried-over occurrences, just today's, so the view doesn't fill up
      // with stale checkmarks.
      if (recentDate === todayISO) {
        items.push({ task, occurrenceDate: recentDate, completed: true, overdue: false, kind: 'today' });
      }

      const nextDate = recentDate === null ? task.dueDate : Recurrence.nextOccurrenceAfter(task, recentDate);
      if (nextDate) {
        items.push({
          task,
          occurrenceDate: nextDate,
          completed: false,
          overdue: false,
          kind: nextDate === todayISO ? 'today' : nextDate === tomorrowISO ? 'tomorrow' : 'upcoming',
        });
      }
    }
  }

  if (now.getHours() >= 18) {
    for (const task of tasks) {
      const alreadyShown = items.some((i) => i.task.id === task.id && i.occurrenceDate === tomorrowISO);
      if (!alreadyShown && Recurrence.occursOn(task, tomorrowISO)) {
        items.push({ task, occurrenceDate: tomorrowISO, completed: false, overdue: false, kind: 'tomorrow' });
      }
    }
  }

  return items;
}

// Persisted across restarts and app versions (localStorage survives both).
// Deliberately independent of hasOverdueIncompleteTask()/focus-mode below,
// which always use the "pending" computation regardless of this toggle --
// which tasks are actually overdue isn't a display preference.
const TODO_VIEW_MODE_KEY = 'shield-browser-todo-view-mode';

function loadTodoViewMode() {
  return localStorage.getItem(TODO_VIEW_MODE_KEY) === 'next-recurrence' ? 'next-recurrence' : 'pending';
}

let todoViewMode = loadTodoViewMode();

function saveTodoViewMode() {
  localStorage.setItem(TODO_VIEW_MODE_KEY, todoViewMode);
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
  // Nothing overdue and no task voluntarily focused (via its Focus button)
  // -- browse normally.
  if (pendingOverdue.length === 0 && !activeTaskId) {
    window.siteListAPI.setFocusMode(null, null);
    return;
  }
  if (!activeTaskId) {
    window.siteListAPI.setFocusMode([], 'overdue'); // overdue exists but nothing chosen yet -- total lockdown pending a choice
    return;
  }
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  // Tells main.js whether to phrase a blocked page as "you have an overdue
  // task" or "you're voluntarily focused on a task" -- see
  // blocklists/blockedPage.js's focus-mode vs focus-mode-voluntary reasons.
  const reason = pendingOverdue.some((item) => item.task.id === activeTaskId) ? 'overdue' : 'voluntary';
  window.siteListAPI.setFocusMode(activeTask ? taskAllowedHostnames(activeTask) : [], reason);
}

const todoSectionEl = document.getElementById('todo-section');
const todoListEl = document.getElementById('todo-list');
const todoViewportEl = document.getElementById('todo-viewport');
const todoScrollUpBtn = document.getElementById('todo-scroll-up');
const todoScrollDownBtn = document.getElementById('todo-scroll-down');
const todoViewToggleBtn = document.getElementById('todo-view-toggle-btn');

const PENDING_VIEW_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>';
const NEXT_RECURRENCE_VIEW_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17 1l4 4-4 4V6H7a4 4 0 0 0-4 4v1H1v-1a6 6 0 0 1 6-6h10V1zm-10 22l-4-4 4-4v3h10a4 4 0 0 0 4-4v-1h2v1a6 6 0 0 1-6 6H7v3z"/></svg>';

function updateTodoViewToggleButton() {
  if (todoViewMode === 'next-recurrence') {
    todoViewToggleBtn.innerHTML = NEXT_RECURRENCE_VIEW_ICON;
    todoViewToggleBtn.title = 'Showing: next recurrence of every task -- click to switch to pending/overdue tasks';
  } else {
    todoViewToggleBtn.innerHTML = PENDING_VIEW_ICON;
    todoViewToggleBtn.title = 'Showing: pending/overdue tasks -- click to switch to next recurrence of every task';
  }
}

todoViewToggleBtn.onclick = () => {
  todoViewMode = todoViewMode === 'next-recurrence' ? 'pending' : 'next-recurrence';
  saveTodoViewMode();
  updateTodoViewToggleButton();
  renderTodo();
};

function updateTodoScrollButtons() {
  const overflowing = todoViewportEl.scrollHeight > todoViewportEl.clientHeight + 1;
  todoScrollUpBtn.classList.toggle('visible', overflowing);
  todoScrollDownBtn.classList.toggle('visible', overflowing);
  if (!overflowing) return;
  todoScrollUpBtn.disabled = todoViewportEl.scrollTop <= 0;
  todoScrollDownBtn.disabled = todoViewportEl.scrollTop >= todoViewportEl.scrollHeight - todoViewportEl.clientHeight - 1;
}

// A one-task step (the original behavior, matching the groups/sites
// scroll arrows elsewhere) stopped making sense once day headers were
// added -- each click would land on an arbitrary item mid-day rather than
// a meaningful boundary. Instead, page by 3/4 of the viewport's own
// height; the quarter left overlapping keeps the jump from feeling
// disorienting.
function todoScrollStep() {
  return todoViewportEl.clientHeight * 0.75;
}

todoScrollUpBtn.onclick = () => todoViewportEl.scrollBy({ top: -todoScrollStep(), behavior: 'smooth' });
todoScrollDownBtn.onclick = () => todoViewportEl.scrollBy({ top: todoScrollStep(), behavior: 'smooth' });
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

// "Today"/"Yesterday"/"Tomorrow" relative to the real current date, so it
// stays correct across the day boundary without re-deriving it per call --
// anything further out (a carried-over item more than a day overdue) just
// gets its plain weekday + date, since "3 days ago" style phrasing wasn't
// asked for.
function describeDayLabel(dateISO, todayISO) {
  const dateStr = new Date(dateISO + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  if (dateISO === todayISO) return `Today, ${dateStr}`;
  if (dateISO === Recurrence.dateToISO(Recurrence.addDays(new Date(todayISO + 'T00:00:00'), -1))) {
    return `Yesterday, ${dateStr}`;
  }
  if (dateISO === Recurrence.dateToISO(Recurrence.addDays(new Date(todayISO + 'T00:00:00'), 1))) {
    return `Tomorrow, ${dateStr}`;
  }
  return dateStr;
}

const FOCUS_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const FOCUSED_ICON = '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';

function renderTodo() {
  updateTodoViewToggleButton();

  if (tasks.length === 0) {
    todoSectionEl.classList.remove('hidden');
    renderTodoEmptyState();
    updateFocusMode([]);
    updateTodoScrollButtons();
    return;
  }

  // Stays visible once there are any tasks at all, even if none happen to be
  // due today/tomorrow right now -- otherwise the view-mode toggle itself
  // would be unreachable, and "next recurrence" mode specifically exists to
  // show tasks that aren't due today/tomorrow.
  todoSectionEl.classList.remove('hidden');

  const items = todoViewMode === 'next-recurrence' ? computeNextRecurrenceItems() : computeTodoDisplayItems();

  const pendingOverdue = items.filter((item) => item.overdue && !item.completed);
  // Eligible to be (or stay) the focused task: today's occurrence (whether
  // overdue yet or not -- the Focus button lets the user opt into any of
  // today's tasks, not just overdue ones) or a carried-over overdue one.
  const focusEligible = items.filter((item) => (item.kind === 'today' || item.kind === 'carried-over') && !item.completed);

  // A lone overdue CARRIED-OVER task is auto-selected, same as always -- no
  // ambiguity, and (unlike today's tasks) it has no Focus button of its own
  // to explicitly pick it otherwise. A lone overdue TODAY task is NOT
  // auto-selected: it has its own toggleable Focus button below, and
  // auto-selecting it would fight with turning it back off (it would just
  // re-select itself on the very next render).
  const soloCarriedOver = pendingOverdue.length === 1 && pendingOverdue[0].kind === 'carried-over' ? pendingOverdue[0].task.id : null;
  if (soloCarriedOver && !activeTaskId) {
    activeTaskId = soloCarriedOver;
  } else if (activeTaskId && !focusEligible.some((item) => item.task.id === activeTaskId)) {
    activeTaskId = null; // previously-focused task is no longer eligible (completed, or rolled past today) -- ask/pick again
  }
  saveActiveTaskId();

  todoListEl.innerHTML = '';

  // Grouped and headed by occurrence date (Today/Tomorrow/Yesterday/plain
  // date) rather than the flat, task-creation-order list this used to be --
  // makes the 6pm-onward boundary between today's and tomorrow's preview
  // (and any older carried-over items) visually unambiguous. ISO date
  // strings sort chronologically as plain strings, no date parsing needed.
  const itemsByDate = new Map();
  for (const item of items) {
    if (!itemsByDate.has(item.occurrenceDate)) itemsByDate.set(item.occurrenceDate, []);
    itemsByDate.get(item.occurrenceDate).push(item);
  }
  const todayISO = Recurrence.dateToISO(new Date());

  for (const dateISO of [...itemsByDate.keys()].sort()) {
    const header = document.createElement('div');
    header.className = 'todo-day-header';
    header.textContent = describeDayLabel(dateISO, todayISO);
    todoListEl.appendChild(header);

    // Within a day: all-day tasks first (they have no due time to sort by),
    // then earliest due time first, ties broken alphabetically by name
    // ("HH:MM" strings compare correctly as plain strings).
    const dayItems = itemsByDate.get(dateISO).sort((a, b) => {
      if (!!a.task.allDay !== !!b.task.allDay) return a.task.allDay ? -1 : 1;
      if (!a.task.allDay && a.task.dueTime !== b.task.dueTime) return a.task.dueTime < b.task.dueTime ? -1 : 1;
      return a.task.name.localeCompare(b.task.name, undefined, { sensitivity: 'base' });
    });

    for (const item of dayItems) {
      const row = document.createElement('div');
      row.className =
        'todo-item' +
        (item.completed ? ' completed' : '') +
        (item.task.id === activeTaskId ? ' active' : '') +
        (item.task.allDay ? ' all-day' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.completed;
      checkbox.disabled = item.kind === 'tomorrow' || item.kind === 'upcoming';
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
      meta.textContent = item.task.allDay
        ? item.kind === 'tomorrow'
          ? 'Tomorrow, all day'
          : item.overdue && !item.completed
            ? `Overdue since ${item.occurrenceDate}`
            : 'All day'
        : item.kind === 'tomorrow'
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

      // Lets the user voluntarily focus on any of today's tasks -- not just
      // an overdue one -- and toggle back off again. Only one task can be
      // focused at a time (activeTaskId is a single value, not a set), so
      // focusing a different task implicitly un-focuses whichever one was
      // active before. Scoped to today's tasks only: a carried-over
      // (already-past) task has no button here and keeps the older,
      // non-escapable auto-focus behavior when it's the sole overdue task.
      if (item.kind === 'today' && !item.completed) {
        const isFocused = item.task.id === activeTaskId;
        const focusBtn = document.createElement('button');
        focusBtn.className = 'todo-focus-btn' + (isFocused ? ' active' : '');
        focusBtn.innerHTML = isFocused ? FOCUSED_ICON : FOCUS_ICON;
        focusBtn.title = isFocused
          ? 'Stop focusing on this task'
          : "Focus on this task (restricts browsing to its linked groups' sites until done)";
        focusBtn.onclick = (e) => {
          e.stopPropagation();
          activeTaskId = isFocused ? null : item.task.id;
          saveActiveTaskId();
          renderTodo();
        };
        row.appendChild(focusBtn);
      }

      // A 'once' task has no recurrence to split, so its double-click skips
      // straight to editing it -- only recurring tasks get the "which
      // occurrence(s)" choice.
      row.ondblclick = async () => {
        if (item.task.frequency.type === 'once') {
          openTaskForm(item.task);
          return;
        }
        const scope = await showEditScopeChoice();
        if (!scope) return;
        if (scope === 'all') {
          openTaskForm(item.task);
        } else {
          openTaskForm(item.task, { occurrenceDate: item.occurrenceDate, scope });
        }
      };

      todoListEl.appendChild(row);
    }
  }

  updateFocusMode(pendingOverdue);
  updateTodoScrollButtons();
}

const todoManageOverlay = document.getElementById('todo-manage-overlay');
const todoManageListEl = document.getElementById('todo-manage-list');
const todoManageViewToggleBtn = document.getElementById('todo-manage-view-toggle-btn');

// A recurring task whose series has ended (endDate passed) and whose last
// occurrence (on/before endDate) is marked done -- nothing more will ever
// come of it, so "active only" hides it to declutter a long-lived list.
function isTaskDoneAndEnded(task, todayISO) {
  if (!task.endDate || task.endDate >= todayISO) return false;
  const lastOccurrence = Recurrence.mostRecentOccurrenceOnOrBefore(task, todayISO);
  return !!lastOccurrence && !!task.completions[lastOccurrence];
}

const ALL_TASKS_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z"/></svg>';
const ACTIVE_ONLY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 4h18l-7 8v6l-4 2v-8z"/></svg>';

let todoManageViewMode = 'all'; // not persisted -- resets to "all" each session, like edit mode

function updateTodoManageViewToggleButton() {
  if (todoManageViewMode === 'active') {
    todoManageViewToggleBtn.innerHTML = ACTIVE_ONLY_ICON;
    todoManageViewToggleBtn.title = 'Showing: active tasks only (hiding completed tasks past their end date) -- click to show all tasks';
  } else {
    todoManageViewToggleBtn.innerHTML = ALL_TASKS_ICON;
    todoManageViewToggleBtn.title = 'Showing: all tasks -- click to hide completed tasks past their end date';
  }
}

todoManageViewToggleBtn.onclick = () => {
  todoManageViewMode = todoManageViewMode === 'active' ? 'all' : 'active';
  renderTodoManageList();
};

function renderTodoManageList() {
  updateTodoManageViewToggleButton();
  todoManageListEl.innerHTML = '';

  const todayISO = Recurrence.dateToISO(new Date());
  const visibleTasks =
    todoManageViewMode === 'active' ? tasks.filter((t) => !isTaskDoneAndEnded(t, todayISO)) : tasks;

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'todo-manage-empty';
    empty.textContent = 'No tasks yet.';
    todoManageListEl.appendChild(empty);
    return;
  }
  if (visibleTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'todo-manage-empty';
    empty.textContent = 'No active tasks -- everything is completed and past its end date.';
    todoManageListEl.appendChild(empty);
    return;
  }

  for (const task of visibleTasks) {
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

    // Two clicks to delete (arm -> confirm), same as a group's site-remove
    // button, instead of a native confirm() dialog. Moving off the row
    // disarms it back to the trash-can icon.
    const deleteBtn = document.createElement('button');
    const trashIcon =
      '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
    const confirmIcon =
      '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M11 7h2v8h-2zM11 16h2v2h-2z"/></svg>';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = trashIcon;
    let deleteArmed = false;
    deleteBtn.onclick = () => {
      if (!deleteArmed) {
        deleteArmed = true;
        deleteBtn.innerHTML = confirmIcon;
        deleteBtn.title = 'Click again to delete';
        deleteBtn.classList.add('confirm');
      } else {
        deleteTask(task.id);
      }
    };
    row.addEventListener('mouseleave', () => {
      if (!deleteArmed) return;
      deleteArmed = false;
      deleteBtn.innerHTML = trashIcon;
      deleteBtn.title = 'Delete';
      deleteBtn.classList.remove('confirm');
    });
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

// ---------------------------------------------------------------------------
// About dialog: app info plus a "View Change log" button opening a separate,
// larger modal for the changelog itself (welcome/changelog.js), grouped by
// version, newest first. The version number comes live from app.getVersion()
// (main.js) rather than being duplicated here, so it can't drift out of sync
// with package.json.
// ---------------------------------------------------------------------------

const aboutOverlay = document.getElementById('about-overlay');
const aboutVersionEl = document.getElementById('about-version');
const changelogOverlay = document.getElementById('changelog-overlay');
const changelogEntriesEl = document.getElementById('changelog-entries');

function renderChangelog() {
  changelogEntriesEl.innerHTML = '';
  for (const entry of CHANGELOG) {
    const section = document.createElement('div');
    section.className = 'changelog-entry';

    const heading = document.createElement('div');
    heading.className = 'changelog-version';
    heading.textContent = entry.version ? `v${entry.version}` : entry.label;
    if (entry.date) {
      const date = document.createElement('span');
      date.className = 'changelog-date';
      date.textContent = ` — ${entry.date}`;
      heading.appendChild(date);
    }
    section.appendChild(heading);

    const groups = [
      ['Added', entry.added],
      ['Fixed', entry.fixed],
      ['Known issues', entry.known],
    ];
    for (const [label, list] of groups) {
      if (!list || list.length === 0) continue;
      const groupLabel = document.createElement('div');
      groupLabel.className = 'changelog-group-label';
      groupLabel.textContent = label;
      section.appendChild(groupLabel);

      const ul = document.createElement('ul');
      ul.className = 'changelog-list';
      for (const line of list) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      }
      section.appendChild(ul);
    }

    changelogEntriesEl.appendChild(section);
  }
}

document.getElementById('about-btn').onclick = async () => {
  menuDropdown.classList.add('hidden');
  aboutVersionEl.textContent = `Version ${await window.siteListAPI.getAppVersion()}`;
  aboutOverlay.classList.remove('hidden');
};
document.getElementById('about-close').onclick = () => aboutOverlay.classList.add('hidden');
document.getElementById('about-homepage-link').onclick = (e) => {
  e.preventDefault();
  window.siteListAPI.openExternal(e.target.href);
};

document.getElementById('view-changelog-btn').onclick = () => {
  aboutOverlay.classList.add('hidden');
  renderChangelog();
  changelogOverlay.classList.remove('hidden');
};
document.getElementById('changelog-close').onclick = () => changelogOverlay.classList.add('hidden');

// render() (groups) must run before renderTodo(): .todo-section's flex-based
// height depends on #groups-viewport's height already being finalized (set
// by updateGroupsLayout() inside render()) -- calling renderTodo() first
// would measure the todo viewport's available space before groups claim
// theirs, understating how much actually overflows.
render();

renderTodo();
setInterval(renderTodo, 30000); // catches a task crossing its due time without needing user interaction
