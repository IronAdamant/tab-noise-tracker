/* Focus mode: one listening tab stays unmuted. Restore uses the saved snapshot. */
'use strict';

(function () {
  const TN = globalThis.TN = globalThis.TN || {};

  async function updateMuted(tabId, muted) {
    try {
      await chrome.tabs.update(tabId, { muted: muted });
    } catch (error) {
      // The tab can close while a batch of updates is still running.
    }
  }

  async function applyFocus(state) {
    const tabs = await chrome.tabs.query({});
    const plan = TabNoiseModel.planFocusUpdates(tabs, state.listeningTabId, state.listeningHeldMuted);
    for (const tabId of plan.mute) await updateMuted(tabId, true);
    for (const tabId of plan.unmute) await updateMuted(tabId, false);
  }

  async function activeTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tabs[0] ? tabs[0].id : null;
    } catch (error) {
      return null;
    }
  }

  function rememberIfMissing(state, tab) {
    if (!tab || tab.id == null) return;
    const key = String(tab.id);
    if (state.preFocusMuted[key] !== undefined) return;
    state.preFocusMuted[key] = TabNoiseModel.isTabMuted(tab);
  }

  // preFocusMuted is the mute state from when Focus mode first saw the tab.
  // Turning Focus off puts each tab back to that snapshot.
  async function enableFocus() {
    const tabs = await chrome.tabs.query({});
    const preFocusMuted = {};
    tabs.forEach(function (item) {
      if (item && item.id != null) preFocusMuted[String(item.id)] = TabNoiseModel.isTabMuted(item);
    });
    const listeningTabId = await activeTabId();
    const state = {
      focusEnabled: true,
      listeningTabId: listeningTabId,
      listeningHeldMuted: false,
      preFocusMuted: preFocusMuted
    };
    await TN.setFocusState(state);
    await applyFocus(state);
    return TabNoiseModel.audibleTabsToSilence(tabs, listeningTabId);
  }

  async function disableFocus() {
    const state = await TN.getFocusState();
    const tabs = await chrome.tabs.query({});
    const ops = TabNoiseModel.planFocusRestore(tabs, state.preFocusMuted);
    for (const op of ops) await updateMuted(op.tabId, op.muted);
    await TN.setFocusState({
      focusEnabled: false,
      listeningTabId: null,
      listeningHeldMuted: false,
      preFocusMuted: {}
    });
  }

  async function reapplyFocus() {
    const state = await TN.getFocusState();
    if (!state.focusEnabled) return;
    await applyFocus(state);
  }

  async function moveListening(tabId) {
    const state = await TN.getFocusState();
    if (!state.focusEnabled || tabId == null) return [];
    const tabs = await chrome.tabs.query({});
    const current = tabs.find(function (item) { return item.id === tabId; });
    if (!current) return [];
    rememberIfMissing(state, current);
    if (state.listeningTabId === tabId && !state.listeningHeldMuted) {
      await TN.setFocusState(state);
      await applyFocus(state);
      return [];
    }
    const silenced = TabNoiseModel.audibleTabsToSilence(tabs, tabId);
    state.listeningTabId = tabId;
    state.listeningHeldMuted = false;
    await TN.setFocusState(state);
    await applyFocus(state);
    return silenced;
  }

  async function noteTabCreated(tab) {
    const state = await TN.getFocusState();
    if (!state.focusEnabled || !tab || tab.id == null) return [];
    rememberIfMissing(state, tab);
    await TN.setFocusState(state);
    if (tab.active) return moveListening(tab.id);
    if (!TabNoiseModel.isTabMuted(tab)) await updateMuted(tab.id, true);
    return [];
  }

  async function noteTabRemoved(tabId) {
    const state = await TN.getFocusState();
    if (!state.focusEnabled) return [];
    delete state.preFocusMuted[String(tabId)];
    if (state.listeningTabId !== tabId) {
      await TN.setFocusState(state);
      return [];
    }
    const nextId = await activeTabId();
    state.listeningTabId = nextId != null && nextId !== tabId ? nextId : null;
    state.listeningHeldMuted = false;
    if (state.listeningTabId != null && state.preFocusMuted[String(state.listeningTabId)] === undefined) {
      const tabs = await chrome.tabs.query({});
      const next = tabs.find(function (item) { return item.id === state.listeningTabId; });
      rememberIfMissing(state, next);
    }
    const tabs = await chrome.tabs.query({});
    const silenced = TabNoiseModel.audibleTabsToSilence(tabs, state.listeningTabId);
    await TN.setFocusState(state);
    await applyFocus(state);
    return silenced;
  }

  async function handleUserMute(tabId, mutedInfo) {
    if (!mutedInfo || mutedInfo.reason !== 'user') return [];
    const state = await TN.getFocusState();
    if (!state.focusEnabled) return [];
    if (!mutedInfo.muted) {
      if (tabId === state.listeningTabId) {
        if (state.listeningHeldMuted) {
          state.listeningHeldMuted = false;
          await TN.setFocusState(state);
        }
        return [];
      }
      return moveListening(tabId);
    }
    if (tabId === state.listeningTabId && !state.listeningHeldMuted) {
      state.listeningHeldMuted = true;
      await TN.setFocusState(state);
    }
    return [];
  }

  async function setTabMuted(tabId, muted) {
    const state = await TN.getFocusState();
    if (!state.focusEnabled) {
      await updateMuted(tabId, !!muted);
      return [];
    }
    if (!muted) return moveListening(tabId);
    if (state.preFocusMuted[String(tabId)] === undefined) {
      try {
        const current = await chrome.tabs.get(tabId);
        rememberIfMissing(state, current);
        await TN.setFocusState(state);
      } catch (error) {
        return [];
      }
    }
    if (tabId === state.listeningTabId) {
      const fresh = await TN.getFocusState();
      fresh.listeningHeldMuted = true;
      await TN.setFocusState(fresh);
    }
    await updateMuted(tabId, true);
    return [];
  }

  async function followFocusedWindow(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return [];
    const state = await TN.getFocusState();
    if (!state.focusEnabled) return [];
    let active = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
      active = tabs[0] || null;
    } catch (error) {
      return [];
    }
    if (!active || active.id === state.listeningTabId) return [];
    return moveListening(active.id);
  }

  TN.enableFocus = enableFocus;
  TN.disableFocus = disableFocus;
  TN.reapplyFocus = reapplyFocus;
  TN.moveListening = moveListening;
  TN.noteTabCreated = noteTabCreated;
  TN.noteTabRemoved = noteTabRemoved;
  TN.handleUserMute = handleUserMute;
  TN.setTabMuted = setTabMuted;
  TN.followFocusedWindow = followFocusedWindow;
})();
