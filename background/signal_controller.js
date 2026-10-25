/* Badge, toolbar flash, on-page flash injection, and silent tab notifications. */
'use strict';

(function () {
  const TN = globalThis.TN = globalThis.TN || {};
  const NORMAL_ICONS = {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  };
  const ALERT_ICONS = {
    16: 'icons/alert16.png',
    32: 'icons/alert32.png',
    48: 'icons/alert48.png',
    128: 'icons/alert128.png'
  };

  const endTimers = new Map();
  const localToolbarTabs = new Set();
  let toolbarTimer = null;
  let pagePulsing = false;

  function later(task, delay) {
    return setTimeout(function () {
      const enqueue = TN.enqueue;
      if (enqueue) enqueue(task);
      else task();
    }, delay);
  }

  function stopToolbarClock() {
    if (toolbarTimer) clearTimeout(toolbarTimer);
    toolbarTimer = null;
  }

  function stopLocalToolbar(tabId) {
    if (tabId != null) localToolbarTabs.delete(tabId);
    if (!localToolbarTabs.size) stopToolbarClock();
  }

  function clearEndTimer(tabId) {
    const timer = endTimers.get(tabId);
    if (timer) clearTimeout(timer);
    endTimers.delete(tabId);
  }

  function paintToolbar(mode, settings) {
    const alertColor = settings && settings.color ? settings.color : TabNoiseModel.DEFAULT_SETTINGS.color;
    const background = mode === 'dim' ? TabNoiseModel.BADGE_COLORS.dim : alertColor;
    const ink = mode === 'dim' ? '#FFFFFF' : TabNoiseModel.inkFor(background);
    const icon = mode === 'alert' ? ALERT_ICONS : NORMAL_ICONS;
    Promise.resolve(chrome.action.setIcon({ path: icon })).catch(function () {});
    Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: background })).catch(function () {});
    if (chrome.action.setBadgeTextColor) {
      Promise.resolve(chrome.action.setBadgeTextColor({ color: ink })).catch(function () {});
    }
  }

  async function refreshBadge() {
    const tabs = await chrome.tabs.query({});
    const counts = TabNoiseModel.soundCounts(tabs);
    const runtime = await TN.getRuntime();
    const flashCount = Object.keys(TabNoiseModel.activeFlashes(runtime.flashing, Date.now())).length;
    const settings = await TN.getSettings();
    await chrome.action.setBadgeText({ text: TabNoiseModel.badgeText(counts, flashCount) });
    await chrome.action.setTitle({ title: TabNoiseModel.badgeTitle(counts, flashCount) });
    if (pagePulsing || toolbarTimer) return;

    if (flashCount > 0 && settings.toolbar) {
      paintToolbar('alert', settings);
      return;
    }

    const background = counts.playing > 0
      ? TabNoiseModel.BADGE_COLORS.playing
      : counts.audible > 0 ? TabNoiseModel.BADGE_COLORS.muted : TabNoiseModel.BADGE_COLORS.quiet;
    const ink = counts.playing > 0 ? TabNoiseModel.inkFor(background) : '#FFFFFF';
    await chrome.action.setIcon({ path: NORMAL_ICONS });
    await chrome.action.setBadgeBackgroundColor({ color: background });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: ink });
    }
  }

  function runLocalToolbar(tabId, settings, reduced) {
    if (!settings.toolbar) return;
    localToolbarTabs.add(tabId);
    if (reduced) {
      paintToolbar('alert', settings);
      return;
    }
    if (toolbarTimer) return;
    const cycles = settings.continuous ? Math.max(settings.pulseCount, 4) : settings.pulseCount;
    const half = Math.max(250, Math.round(settings.intervalMs / 2));
    let step = 0;
    const tick = function () {
      if (!localToolbarTabs.size) {
        stopToolbarClock();
        return;
      }
      paintToolbar(step % 2 === 0 ? 'alert' : 'dim', settings);
      step += 1;
      if (step >= cycles * 2) {
        paintToolbar('alert', settings);
        stopToolbarClock();
        return;
      }
      toolbarTimer = setTimeout(tick, half);
    };
    tick();
  }

  function scheduleEnd(tabId, delay) {
    clearEndTimer(tabId);
    const timer = later(function () {
      return clearFlash(tabId, { tellPage: true });
    }, Math.max(0, delay));
    endTimers.set(tabId, timer);
  }

  function classifyPage(tab) {
    if (!tab) return 'failed';
    if (tab.discarded || tab.status === 'unloaded') return 'asleep';
    if (/^https?:/i.test(tab.url || '')) return 'web';
    return 'browser';
  }

  async function markUnsupported(tabId, reason) {
    const runtime = await TN.getRuntime();
    runtime.unsupported[String(tabId)] = reason;
    await TN.setRuntime(runtime);
  }

  async function tryPageFlash(tab, settings, reason) {
    if (!settings.overlay && !settings.titleMarker) return false;
    const kind = classifyPage(tab);
    if (kind !== 'web') {
      await markUnsupported(tab.id, kind === 'asleep' ? 'asleep' : 'browser');
      return false;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared/tracker_model.js', 'content/visual_alert.js']
      });
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'tn-flash-start',
        target: 'content',
        config: settings,
        reason: reason
      });
      if (response && response.ok) {
        const runtime = await TN.getRuntime();
        delete runtime.unsupported[String(tab.id)];
        await TN.setRuntime(runtime);
        return true;
      }
    } catch (error) {
      await markUnsupported(tab.id, 'failed');
      return false;
    }
    await markUnsupported(tab.id, 'failed');
    return false;
  }

  async function tellPageToStop(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'tn-flash-stop', target: 'content' });
    } catch (error) {
      // Built-in pages and closed tabs have no content script.
    }
    try {
      await chrome.runtime.sendMessage({ type: 'tn-flash-stop', target: 'extension-page', tabId: tabId });
    } catch (error) {
      // No extension page is listening.
    }
  }

  async function clearNotification(tabId) {
    if (!chrome.notifications) return;
    try {
      await chrome.notifications.clear('tab-noise-' + tabId);
    } catch (error) {
      // Already gone.
    }
  }

  async function clearFlash(tabId, options) {
    const key = String(tabId);
    stopLocalToolbar(tabId);
    clearEndTimer(tabId);
    const runtime = await TN.getRuntime();
    const had = !!runtime.flashing[key];
    delete runtime.flashing[key];
    delete runtime.unsupported[key];
    await TN.setRuntime(runtime);
    if (!Object.keys(TabNoiseModel.activeFlashes(runtime.flashing, Date.now())).length) {
      pagePulsing = false;
    }
    if (!options || options.tellPage !== false) await tellPageToStop(tabId);
    if (had) await refreshBadge();
  }

  async function clearCooldown(tabId) {
    const runtime = await TN.getRuntime();
    delete runtime.cooldown[String(tabId)];
    await TN.setRuntime(runtime);
  }

  async function forgetTab(tabId) {
    stopLocalToolbar(tabId);
    clearEndTimer(tabId);
    const runtime = await TN.getRuntime();
    const key = String(tabId);
    delete runtime.flashing[key];
    delete runtime.silenced[key];
    delete runtime.unsupported[key];
    delete runtime.cooldown[key];
    await TN.setRuntime(runtime);
    if (!Object.keys(runtime.flashing).length) pagePulsing = false;
    await clearNotification(tabId);
    await refreshBadge();
  }

  async function startFlash(tabId, reason, options) {
    const settings = TabNoiseModel.normalizeSettings(
      options && options.settings ? options.settings : await TN.getSettings()
    );
    if (reason === 'focus-mute' && !settings.flashOnFocusMute) return false;
    if (!settings.overlay && !settings.titleMarker && !settings.toolbar) return false;

    const now = Date.now();
    const runtime = await TN.getRuntime();
    const key = String(tabId);
    // Only an audible-edge alert starts the cooldown. A Focus mute or a
    // settings test must not swallow the next real "sound started" flash.
    const bypass = options && options.bypassCooldown;
    if (reason === 'audible' && !bypass) {
      if (!TabNoiseModel.shouldStartAudibleAlert(Number(runtime.cooldown[key]) || 0, now)) return false;
      runtime.cooldown[key] = now;
    }
    const reduced = await TN.reducedMotionPreferred();
    runtime.flashing[key] = {
      reason: reason,
      until: now + TabNoiseModel.flashDurationMs(settings, reduced)
    };
    delete runtime.unsupported[key];
    await TN.setRuntime(runtime);

    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (error) {
      await clearFlash(tabId, { tellPage: false });
      return false;
    }

    const pageDriven = !!(options && options.pageDriven);
    let drove = pageDriven;
    if (!pageDriven && reason !== 'test') {
      drove = await tryPageFlash(tab, settings, reason);
    }
    if (!drove && settings.toolbar) runLocalToolbar(tabId, settings, reduced);
    scheduleEnd(tabId, runtime.flashing[key].until - Date.now());
    await refreshBadge();
    return true;
  }

  async function recordSilenced(ids) {
    if (!ids || !ids.length) return;
    const runtime = await TN.getRuntime();
    const until = Date.now() + TabNoiseModel.SILENCE_LIST_MS;
    ids.forEach(function (id) {
      runtime.silenced[String(id)] = until;
    });
    await TN.setRuntime(runtime);
  }

  async function onAudibleStopped(tabId) {
    const runtime = await TN.getRuntime();
    const flash = runtime.flashing[String(tabId)];
    if (flash && flash.reason === 'audible') await clearFlash(tabId, { tellPage: true });
  }

  async function retryPageFlash(tabId) {
    const runtime = await TN.getRuntime();
    const key = String(tabId);
    const flash = runtime.flashing[key];
    if (!TabNoiseModel.activeFlashes(runtime.flashing, Date.now())[key]) return;
    if (runtime.unsupported[key] !== 'asleep') return;
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (error) {
      return;
    }
    const settings = await TN.getSettings();
    const drove = await tryPageFlash(tab, settings, flash.reason || 'audible');
    if (drove) stopLocalToolbar(tabId);
  }

  async function purgeRuntime() {
    const runtime = await TN.getRuntime();
    const now = Date.now();
    const flashing = TabNoiseModel.activeFlashes(runtime.flashing, now);
    const silenced = {};
    Object.keys(runtime.silenced).forEach(function (id) {
      if (Number(runtime.silenced[id]) > now) silenced[id] = runtime.silenced[id];
    });
    for (const id of Object.keys(flashing)) {
      try {
        await chrome.tabs.get(Number(id));
        scheduleEnd(Number(id), Number(flashing[id].until) - now);
      } catch (error) {
        delete flashing[id];
      }
    }
    runtime.flashing = flashing;
    runtime.silenced = silenced;
    await TN.setRuntime(runtime);
  }

  async function handleToolbarPhase(tabId, bright) {
    const runtime = await TN.getRuntime();
    if (!TabNoiseModel.activeFlashes(runtime.flashing, Date.now())[String(tabId)]) return;
    const settings = await TN.getSettings();
    if (!settings.toolbar) return;
    pagePulsing = true;
    stopLocalToolbar(tabId);
    paintToolbar(bright ? 'alert' : 'dim', settings);
  }

  async function handleToolbarHold(tabId) {
    const runtime = await TN.getRuntime();
    if (!TabNoiseModel.activeFlashes(runtime.flashing, Date.now())[String(tabId)]) return;
    pagePulsing = false;
    stopLocalToolbar(tabId);
    paintToolbar('alert', await TN.getSettings());
  }

  function notificationsGranted() {
    return new Promise(function (resolve) {
      if (!chrome.notifications || !chrome.notifications.getPermissionLevel) {
        resolve(false);
        return;
      }
      chrome.notifications.getPermissionLevel(function (level) {
        resolve(level === 'granted');
      });
    });
  }

  async function notifyAudible(tab) {
    const settings = await TN.getSettings();
    if (!settings.tabAlerts || !tab) return;
    try {
      const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const active = activeTabs[0];
      if (active && active.id === tab.id && (settings.overlay || settings.titleMarker)) return;
    } catch (error) {
      // Still try to show the notification.
    }
    if (!(await notificationsGranted())) return;
    const title = TabNoiseModel.stripMarker(tab.title || '').replace(/\s+/g, ' ').trim() || 'Untitled tab';
    try {
      await chrome.notifications.create('tab-noise-' + tab.id, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'A tab started making sound',
        message: title.slice(0, 180),
        silent: true,
        priority: 2
      });
    } catch (error) {
      // The OS can block notifications without failing the rest of the alert.
    }
  }

  async function openNotifiedTab(notificationId) {
    const match = /^tab-noise-(\d+)$/.exec(notificationId || '');
    if (!match) return;
    const tabId = Number(match[1]);
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    } catch (error) {
      // The tab closed before the notification was clicked.
    }
    await clearNotification(tabId);
  }

  async function beginTestFlash(tabId, rawSettings, pageDriven) {
    const settings = TabNoiseModel.normalizeSettings(rawSettings);
    if (!settings.overlay && !settings.titleMarker && !settings.toolbar) {
      return { ok: false, error: 'Turn on at least one alert surface first.' };
    }
    const started = await startFlash(tabId, 'test', {
      bypassCooldown: true,
      settings: settings,
      pageDriven: !!pageDriven
    });
    return started
      ? { ok: true }
      : { ok: false, error: 'Could not start the test flash.' };
  }

  TN.refreshBadge = refreshBadge;
  TN.startFlash = startFlash;
  TN.clearFlash = clearFlash;
  TN.clearCooldown = clearCooldown;
  TN.forgetTab = forgetTab;
  TN.recordSilenced = recordSilenced;
  TN.onAudibleStopped = onAudibleStopped;
  TN.retryPageFlash = retryPageFlash;
  TN.purgeRuntime = purgeRuntime;
  TN.handleToolbarPhase = handleToolbarPhase;
  TN.handleToolbarHold = handleToolbarHold;
  TN.notifyAudible = notifyAudible;
  TN.openNotifiedTab = openNotifiedTab;
  TN.beginTestFlash = beginTestFlash;
})();
