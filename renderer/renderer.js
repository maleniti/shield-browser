const tabsEl = document.getElementById('tabs');
const addressBar = document.getElementById('address-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const shieldBtn = document.getElementById('shield-btn');
const newTabBtn = document.getElementById('new-tab-btn');

let addressBarFocused = false;
addressBar.addEventListener('focus', () => {
  addressBarFocused = true;
  addressBar.select();
});
addressBar.addEventListener('blur', () => (addressBarFocused = false));

// A plain 'focus' handler alone isn't enough: the native mouseup that
// follows a focusing click fires after 'focus' and collapses the selection
// to the click position. Suppress that one mouseup so select() sticks.
let addressBarJustFocused = false;
addressBar.addEventListener('mousedown', () => {
  addressBarJustFocused = document.activeElement !== addressBar;
});
addressBar.addEventListener('mouseup', (e) => {
  if (addressBarJustFocused) {
    e.preventDefault();
    addressBarJustFocused = false;
  }
});

const tabStripEl = document.getElementById('tab-strip');
tabStripEl.addEventListener('dblclick', (e) => {
  if (e.target === tabStripEl || e.target === tabsEl) window.browserAPI.newTab();
});

// Firefox-style overflow arrows instead of a visible scrollbar: tabs keep a
// fixed width (no Firefox-style shrink-to-fit), and these just scroll the
// already-hidden-scrollbar #tabs by one tab at a time.
const scrollLeftBtn = document.getElementById('tabs-scroll-left');
const scrollRightBtn = document.getElementById('tabs-scroll-right');

function tabScrollStep() {
  const tab = tabsEl.querySelector('.tab');
  if (!tab) return 130;
  const style = getComputedStyle(tabsEl);
  return tab.getBoundingClientRect().width + parseFloat(style.gap || '4');
}

function updateTabScrollButtons() {
  const overflowing = tabsEl.scrollWidth > tabsEl.clientWidth + 1;
  scrollLeftBtn.classList.toggle('visible', overflowing);
  scrollRightBtn.classList.toggle('visible', overflowing);
  if (!overflowing) return;
  scrollLeftBtn.disabled = tabsEl.scrollLeft <= 0;
  scrollRightBtn.disabled = tabsEl.scrollLeft >= tabsEl.scrollWidth - tabsEl.clientWidth - 1;
}

scrollLeftBtn.onclick = () => tabsEl.scrollBy({ left: -tabScrollStep(), behavior: 'smooth' });
scrollRightBtn.onclick = () => tabsEl.scrollBy({ left: tabScrollStep(), behavior: 'smooth' });
tabsEl.addEventListener('scroll', updateTabScrollButtons);
window.addEventListener('resize', updateTabScrollButtons);

function render(state) {
  const { tabs, activeTabId } = state;
  const active = tabs.find((t) => t.id === activeTabId);

  tabsEl.innerHTML = '';
  let activeTabEl = null;
  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => window.browserAPI.switchTab(tab.id);
    if (tab.id === activeTabId) activeTabEl = el;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.loading ? 'Loading…' : tab.title;
    el.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.onclick = (e) => {
      e.stopPropagation();
      window.browserAPI.closeTab(tab.id);
    };
    el.appendChild(close);

    tabsEl.appendChild(el);
  }
  if (activeTabEl) activeTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTabScrollButtons();

  if (active) {
    if (!addressBarFocused) addressBar.value = active.url;
    backBtn.disabled = !active.canGoBack;
    forwardBtn.disabled = !active.canGoForward;
    shieldBtn.disabled = active.isWelcome;
    shieldBtn.classList.toggle('enabled', active.allowed);
    shieldBtn.title = active.isWelcome
      ? 'JavaScript & cookies are always on for this built-in page'
      : active.allowed
        ? 'JavaScript & cookies are allowed on this tab (click to block again)'
        : 'JavaScript & cookies are blocked on this tab (click to allow)';
  }
}

window.browserAPI.onTabsState(render);
window.browserAPI.getState().then(render);

let activeId = null;
window.browserAPI.onTabsState((state) => {
  activeId = state.activeTabId;
});

newTabBtn.onclick = () => window.browserAPI.newTab();
backBtn.onclick = () => window.browserAPI.goBack(activeId);
forwardBtn.onclick = () => window.browserAPI.goForward(activeId);
reloadBtn.onclick = () => window.browserAPI.reload(activeId);
shieldBtn.onclick = () => window.browserAPI.toggleJsCookies(activeId);

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.browserAPI.navigate(activeId, addressBar.value);
    addressBar.blur();
  }
});
