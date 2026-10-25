/* Popup: live audible tabs, Focus mode, and per-tab controls. */
'use strict';

(function () {
  const summary = document.getElementById('summary');
  const list = document.getElementById('tab-list');
  const empty = document.getElementById('empty');
  const focusToggle = document.getElementById('focus-toggle');
  const focusState = document.getElementById('focus-state');
  const shortcut = document.getElementById('shortcut');
  const tabAlerts = document.getElementById('tab-alerts');
  const error = document.getElementById('error');
  let lastSignature = '';
  let refreshTimer = null;
  let requestId = 0;

  function showError(text) {
    error.hidden = !text;
    error.textContent = text || '';
  }

  function explain(err) {
    const text = err && err.message ? err.message : 'Something went wrong.';
    if (/Receiving end does not exist/i.test(text)) {
      return 'The extension background is still starting. Try again.';
    }
    return text;
  }

  function controlKey(element) {
    if (!element || !element.dataset) return '';
    return element.dataset.control || '';
  }

  async function loadModel() {
    const [tabs, windows, local, session] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll({}),
      chrome.storage.local.get(null),
      chrome.storage.session.get(null)
    ]);
    const now = Date.now();
    const settings = TabNoiseModel.normalizeSettings(local.settings);
    const focusEnabled = !!local.focusEnabled;
    const listeningTabId = typeof local.listeningTabId === 'number' ? local.listeningTabId : null;
    const rows = TabNoiseModel.buildRows({
      tabs: tabs,
      windows: windows,
      focusEnabled: focusEnabled,
      listeningTabId: listeningTabId,
      flashing: session.flashing || {},
      silenced: session.silenced || {},
      unsupported: session.unsupported || {},
      now: now
    });
    const flashingCount = Object.keys(TabNoiseModel.activeFlashes(session.flashing || {}, now)).length;
    const silencedCount = rows.filter(function (row) { return !row.audible && !row.flashing; }).length;
    return {
      settings: settings,
      focusEnabled: focusEnabled,
      rows: rows,
      summary: TabNoiseModel.summaryText(tabs, {
        focusEnabled: focusEnabled,
        flashingCount: flashingCount,
        silencedCount: silencedCount
      })
    };
  }

  function button(label, action, tabId, title) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.dataset.action = action;
    control.dataset.tabId = String(tabId);
    control.dataset.control = action + '-' + tabId;
    control.setAttribute('aria-label', label + ' “' + title + '”');
    return control;
  }

  function renderList(rows) {
    const signature = JSON.stringify(rows);
    if (signature === lastSignature) return;
    const activeKey = controlKey(document.activeElement);
    const scroll = list.scrollTop;
    list.replaceChildren();
    rows.forEach(function (row) {
      const item = document.createElement('li');
      const article = document.createElement('article');
      article.className = 'tab-row' + (row.flashing ? ' is-flashing' : '');
      const titleId = 'tab-title-' + row.tabId;
      article.setAttribute('aria-labelledby', titleId);

      const identity = document.createElement('div');
      identity.className = 'identity';
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.style.background = row.markColor;
      mark.textContent = row.monogram;
      const text = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'title';
      title.id = titleId;
      title.textContent = row.title;
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = row.windowLine;
      const status = document.createElement('p');
      status.className = 'status';
      status.textContent = row.statusLabel;
      if (row.showMeter) {
        const meter = document.createElement('span');
        meter.className = 'meter';
        meter.setAttribute('aria-hidden', 'true');
        meter.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        status.append(meter);
      }
      text.append(title, meta, status);
      if (row.pageNote) {
        const note = document.createElement('p');
        note.className = 'page-note';
        note.textContent = row.pageNote;
        text.append(note);
      }
      identity.append(mark, text);

      const actions = document.createElement('div');
      actions.className = 'actions';
      if (row.flashing) actions.append(button('Stop flash', 'dismiss', row.tabId, row.title));
      actions.append(button(row.muted ? 'Unmute' : 'Mute', 'mute', row.tabId, row.title));
      actions.append(button('Jump to tab', 'jump', row.tabId, row.title));
      actions.append(button('Close tab', 'close', row.tabId, row.title));

      article.append(identity, actions);
      item.append(article);
      list.append(item);
    });
    list.scrollTop = scroll;
    lastSignature = signature;
    if (activeKey) {
      const next = list.querySelector('[data-control="' + CSS.escape(activeKey) + '"]');
      if (next) next.focus();
    }
  }

  function render(model) {
    if (summary.textContent !== model.summary) summary.textContent = model.summary;
    focusToggle.setAttribute('aria-checked', model.focusEnabled ? 'true' : 'false');
    focusState.textContent = model.focusEnabled ? 'On' : 'Off';
    if (document.activeElement !== tabAlerts && tabAlerts.checked !== model.settings.tabAlerts) {
      tabAlerts.checked = model.settings.tabAlerts;
    }
    empty.hidden = model.rows.length !== 0;
    renderList(model.rows);
  }

  async function refresh() {
    const id = ++requestId;
    try {
      const model = await loadModel();
      if (id !== requestId) return;
      render(model);
      showError('');
    } catch (err) {
      if (id !== requestId) return;
      showError(explain(err));
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh();
    }, 50);
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.ok === false) {
      throw new Error(response && response.error ? response.error : 'The extension background did not answer.');
    }
    return response;
  }

  focusToggle.addEventListener('click', async function () {
    const enabled = focusToggle.getAttribute('aria-checked') !== 'true';
    focusToggle.disabled = true;
    try {
      await send({ type: 'tn-focus', enabled: enabled });
      showError('');
      await refresh();
    } catch (err) {
      showError(explain(err));
    } finally {
      focusToggle.disabled = false;
    }
  });

  tabAlerts.addEventListener('change', async function () {
    try {
      const local = await chrome.storage.local.get('settings');
      const next = TabNoiseModel.mergeSettings(local.settings, { tabAlerts: tabAlerts.checked });
      await chrome.storage.local.set({ settings: next });
      showError('');
    } catch (err) {
      showError(explain(err));
    }
  });

  document.getElementById('open-options').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  list.addEventListener('click', async function (event) {
    const control = event.target.closest('button');
    if (!control || !list.contains(control)) return;
    const tabId = Number(control.dataset.tabId);
    const action = control.dataset.action;
    control.disabled = true;
    try {
      if (action === 'mute') {
        const mute = control.textContent === 'Mute';
        await send({ type: 'tn-mute', tabId: tabId, muted: mute });
      } else if (action === 'jump') {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else if (action === 'close') {
        await chrome.tabs.remove(tabId);
      } else if (action === 'dismiss') {
        await send({ type: 'tn-dismiss', tabId: tabId });
      }
      showError('');
      await refresh();
    } catch (err) {
      showError(explain(err));
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });

  chrome.tabs.onUpdated.addListener(function (tabId, info) {
    if (info.audible != null || info.mutedInfo || info.title || info.status) scheduleRefresh();
  });
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onActivated.addListener(scheduleRefresh);
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' || area === 'session') scheduleRefresh();
  });

  chrome.storage.local.set({
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }).catch(function () {});

  chrome.commands.getAll().then(function (commands) {
    const toggle = (commands || []).find(function (command) { return command.name === 'toggle-focus'; });
    if (toggle && toggle.shortcut) {
      shortcut.textContent = 'Keyboard shortcut: ' + toggle.shortcut + '.';
      focusToggle.setAttribute('aria-keyshortcuts', toggle.shortcut);
    }
  }).catch(function () {});

  refresh();
})();
