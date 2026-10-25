/* chrome.storage access for settings, Focus mode, and short-lived alert state. */
'use strict';

(function () {
  const TN = globalThis.TN = globalThis.TN || {};

  function mapOrEmpty(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  }

  function sameSettings(stored, normalized) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
    const keys = Object.keys(normalized);
    if (Object.keys(stored).length !== keys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (!Object.prototype.hasOwnProperty.call(stored, key)) return false;
      if (stored[key] !== normalized[key]) return false;
    }
    return true;
  }

  // New installs get the current defaults. Saved switches stay as set.
  // A missing faviconFlash (older installs) turns on without clearing overlay.
  async function ensureSettings() {
    const data = await chrome.storage.local.get('settings');
    const normalized = TabNoiseModel.normalizeSettings(data.settings);
    if (!sameSettings(data.settings, normalized)) {
      await chrome.storage.local.set({ settings: normalized });
    }
    return normalized;
  }

  async function getSettings() {
    const data = await chrome.storage.local.get('settings');
    return TabNoiseModel.normalizeSettings(data.settings);
  }

  async function getFocusState() {
    const data = await chrome.storage.local.get([
      'focusEnabled',
      'listeningTabId',
      'listeningHeldMuted',
      'preFocusMuted'
    ]);
    return {
      focusEnabled: !!data.focusEnabled,
      listeningTabId: typeof data.listeningTabId === 'number' ? data.listeningTabId : null,
      listeningHeldMuted: !!data.listeningHeldMuted,
      preFocusMuted: mapOrEmpty(data.preFocusMuted)
    };
  }

  async function setFocusState(state) {
    await chrome.storage.local.set({
      focusEnabled: !!state.focusEnabled,
      listeningTabId: typeof state.listeningTabId === 'number' ? state.listeningTabId : null,
      listeningHeldMuted: !!state.listeningHeldMuted,
      preFocusMuted: mapOrEmpty(state.preFocusMuted)
    });
  }

  async function getRuntime() {
    const data = await chrome.storage.session.get(['flashing', 'silenced', 'unsupported', 'cooldown']);
    return {
      flashing: mapOrEmpty(data.flashing),
      silenced: mapOrEmpty(data.silenced),
      unsupported: mapOrEmpty(data.unsupported),
      cooldown: mapOrEmpty(data.cooldown)
    };
  }

  async function setRuntime(runtime) {
    await chrome.storage.session.set({
      flashing: mapOrEmpty(runtime.flashing),
      silenced: mapOrEmpty(runtime.silenced),
      unsupported: mapOrEmpty(runtime.unsupported),
      cooldown: mapOrEmpty(runtime.cooldown)
    });
  }

  async function reducedMotionPreferred() {
    try {
      const data = await chrome.storage.local.get('reducedMotion');
      return !!data.reducedMotion;
    } catch (error) {
      return false;
    }
  }

  TN.ensureSettings = ensureSettings;
  TN.getSettings = getSettings;
  TN.getFocusState = getFocusState;
  TN.setFocusState = setFocusState;
  TN.getRuntime = getRuntime;
  TN.setRuntime = setRuntime;
  TN.reducedMotionPreferred = reducedMotionPreferred;
})();
