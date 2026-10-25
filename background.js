/* Service worker: keep the audible list, Focus mode, and visual alerts alive. */
'use strict';

importScripts(
  'shared/tracker_model.js',
  'background/storage_gateway.js',
  'background/focus_controller.js',
  'background/signal_controller.js'
);

const TN = globalThis.TN;
let chain = Promise.resolve();

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(function () {
    return undefined;
  }, function (error) {
    console.error('Tab Noise Tracker:', error);
  });
  return run;
}

TN.enqueue = enqueue;

async function init() {
  await TN.ensureSettings();
  await TN.reapplyFocus();
  await TN.purgeRuntime();
  await TN.refreshBadge();
}

const ready = enqueue(init).then(function () {
  return undefined;
}, function (error) {
  console.error('Tab Noise Tracker failed to start:', error);
});

function tabIdFrom(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

async function flashSilenced(ids) {
  const settings = await TN.getSettings();
  if (!settings.flashOnFocusMute || !ids) return;
  for (const id of ids) await TN.startFlash(id, 'focus-mute');
}

async function afterFocusMove(ids) {
  await TN.recordSilenced(ids);
  await flashSilenced(ids);
  await TN.refreshBadge();
}

async function onAudibleStarted(tab) {
  const state = await TN.getFocusState();
  if (state.focusEnabled && tab.id !== state.listeningTabId) {
    const silenced = await TN.moveListening(tab.id);
    await TN.recordSilenced(silenced);
    await flashSilenced(silenced);
  }
  await TN.startFlash(tab.id, 'audible');
  await TN.notifyAudible(tab);
}

async function onTabUpdated(tabId, changeInfo, tab) {
  if (!changeInfo) return;
  const loading = changeInfo.status === 'loading';
  const audibleKnown = Object.prototype.hasOwnProperty.call(changeInfo, 'audible');
  const muteKnown = Object.prototype.hasOwnProperty.call(changeInfo, 'mutedInfo');
  if (!loading && changeInfo.status !== 'complete' && !audibleKnown && !muteKnown) return;

  if (loading) {
    await TN.clearFlash(tabId, { tellPage: false });
    await TN.clearCooldown(tabId);
  }
  if (muteKnown) {
    const silenced = await TN.handleUserMute(tabId, changeInfo.mutedInfo);
    await afterFocusMove(silenced);
  }
  if (audibleKnown && changeInfo.audible === false) await TN.onAudibleStopped(tabId);
  if (audibleKnown && changeInfo.audible === true && tab) await onAudibleStarted(tab);
  if (changeInfo.status === 'complete') await TN.retryPageFlash(tabId);
  await TN.refreshBadge();
}

async function onMessage(message, sender) {
  if (!message || typeof message.type !== 'string') return { ok: false, error: 'Unknown message.' };
  if (message.type === 'tn-focus') {
    const enabled = !!message.enabled;
    const state = await TN.getFocusState();
    if (state.focusEnabled === enabled) return { ok: true, focusEnabled: enabled };
    if (enabled) {
      const silenced = await TN.enableFocus();
      await afterFocusMove(silenced);
      return { ok: true, focusEnabled: true };
    }
    await TN.disableFocus();
    await TN.refreshBadge();
    return { ok: true, focusEnabled: false };
  }
  if (message.type === 'tn-mute') {
    const tabId = tabIdFrom(message.tabId);
    if (tabId == null) return { ok: false, error: 'Missing tab.' };
    const silenced = await TN.setTabMuted(tabId, !!message.muted);
    await afterFocusMove(silenced);
    return { ok: true };
  }
  if (message.type === 'tn-dismiss') {
    const tabId = tabIdFrom(message.tabId);
    if (tabId == null) return { ok: false, error: 'Missing tab.' };
    await TN.clearFlash(tabId, { tellPage: true });
    return { ok: true };
  }
  if (message.type === 'tn-dismiss-current') {
    if (!sender.tab) return { ok: false, error: 'Missing tab.' };
    await TN.clearFlash(sender.tab.id, { tellPage: true });
    return { ok: true };
  }
  if (message.type === 'tn-test-flash') {
    const parsedId = tabIdFrom(message.tabId);
    const tabId = parsedId == null && sender.tab ? sender.tab.id : parsedId;
    if (tabId == null) return { ok: false, error: 'Open the settings tab and try again.' };
    return TN.beginTestFlash(tabId, message.settings, !!message.pageDriven);
  }
  if (message.type === 'tn-toolbar-phase' && sender.tab) {
    await TN.handleToolbarPhase(sender.tab.id, !!message.bright);
    return { ok: true };
  }
  if (message.type === 'tn-toolbar-hold' && sender.tab) {
    await TN.handleToolbarHold(sender.tab.id);
    return { ok: true };
  }
  if (message.type === 'tn-flash-ended' && sender.tab) {
    await TN.clearFlash(sender.tab.id, { tellPage: false });
    return { ok: true };
  }
  return { ok: false, error: 'Unknown message.' };
}

function errorText(error) {
  if (!error) return 'Something went wrong.';
  return error.message || 'Something went wrong.';
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  enqueue(function () {
    return ready.then(function () {
      return onTabUpdated(tabId, changeInfo, tab);
    });
  });
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  enqueue(function () {
    return ready.then(async function () {
      const state = await TN.getFocusState();
      if (!state.focusEnabled || activeInfo.tabId === state.listeningTabId) return;
      await afterFocusMove(await TN.moveListening(activeInfo.tabId));
    });
  });
});

chrome.tabs.onCreated.addListener(function (tab) {
  enqueue(function () {
    return ready.then(async function () {
      await afterFocusMove(await TN.noteTabCreated(tab));
    });
  });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  enqueue(function () {
    return ready.then(async function () {
      await TN.forgetTab(tabId);
      await afterFocusMove(await TN.noteTabRemoved(tabId));
    });
  });
});

chrome.windows.onFocusChanged.addListener(function (windowId) {
  enqueue(function () {
    return ready.then(async function () {
      await afterFocusMove(await TN.followFocusedWindow(windowId));
    });
  });
});

chrome.commands.onCommand.addListener(function (command) {
  enqueue(function () {
    return ready.then(async function () {
      if (command !== 'toggle-focus') return;
      const state = await TN.getFocusState();
      if (state.focusEnabled) {
        await TN.disableFocus();
        await TN.refreshBadge();
        return;
      }
      await afterFocusMove(await TN.enableFocus());
    });
  });
});

if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(function (notificationId) {
    enqueue(function () {
      return ready.then(function () {
        return TN.openNotifiedTab(notificationId);
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  enqueue(function () {
    return ready.then(function () {
      return onMessage(message, sender);
    });
  }).then(function (result) {
    sendResponse(result || { ok: true });
  }).catch(function (error) {
    sendResponse({ ok: false, error: errorText(error) });
  });
  return true;
});
