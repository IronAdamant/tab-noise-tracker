/* Pure decisions for Tab Noise Tracker: settings, Focus mute plans, and popup rows. */
'use strict';

(function (root, factory) {
  const api = factory();
  root.TabNoiseModel = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BRIGHT_PREFIX = '🔊 ';
  const DIM_PREFIX = '🔈 ';
  const HOLD_MS = 12000;
  const COOLDOWN_MS = 5000;
  const CONTINUOUS_MS = 6 * 60 * 60 * 1000;
  const SILENCE_LIST_MS = 20000;

  const DEFAULT_SETTINGS = Object.freeze({
    overlay: true,
    titleMarker: true,
    toolbar: true,
    flashOnFocusMute: true,
    tabAlerts: false,
    intensity: 70,
    color: '#E08900',
    style: 'border',
    intervalMs: 1500,
    pulseCount: 4,
    continuous: false
  });

  const COLOR_PRESETS = Object.freeze([
    { id: 'amber', label: 'Amber', value: '#E08900' },
    { id: 'orange', label: 'Orange', value: '#E85D04' },
    { id: 'yellow', label: 'Yellow', value: '#F5C518' },
    { id: 'blue', label: 'Blue', value: '#1D6FEA' },
    { id: 'cyan', label: 'Cyan', value: '#0A6A6A' },
    { id: 'green', label: 'Green', value: '#2E7D32' },
    { id: 'magenta', label: 'Magenta', value: '#C2185B' },
    { id: 'white', label: 'White', value: '#FFFFFF' }
  ]);

  const MARK_COLORS = Object.freeze([
    '#12324A',
    '#0E5C3A',
    '#5C3B16',
    '#3E2A78',
    '#8D1D1D',
    '#0C3F86'
  ]);

  const BADGE_COLORS = Object.freeze({
    playing: '#E08900',
    muted: '#5C564C',
    quiet: '#12324A',
    dim: '#1B1404'
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeColor(value) {
    if (typeof value !== 'string') return DEFAULT_SETTINGS.color;
    const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
    return match ? '#' + match[1].toUpperCase() : DEFAULT_SETTINGS.color;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === 'object' ? input : {};
    const interval = Number(source.intervalMs);
    const stepped = Number.isFinite(interval) ? Math.round(interval / 100) * 100 : DEFAULT_SETTINGS.intervalMs;
    const style = source.style === 'solid' || source.style === 'border' || source.style === 'text'
      ? source.style
      : DEFAULT_SETTINGS.style;
    return {
      overlay: source.overlay == null ? DEFAULT_SETTINGS.overlay : !!source.overlay,
      titleMarker: source.titleMarker == null ? DEFAULT_SETTINGS.titleMarker : !!source.titleMarker,
      toolbar: source.toolbar == null ? DEFAULT_SETTINGS.toolbar : !!source.toolbar,
      flashOnFocusMute: source.flashOnFocusMute == null
        ? DEFAULT_SETTINGS.flashOnFocusMute
        : !!source.flashOnFocusMute,
      tabAlerts: source.tabAlerts == null ? DEFAULT_SETTINGS.tabAlerts : !!source.tabAlerts,
      intensity: clamp(Math.round(Number(source.intensity) || DEFAULT_SETTINGS.intensity), 10, 100),
      color: normalizeColor(source.color),
      style: style,
      intervalMs: clamp(stepped, 500, 2500),
      pulseCount: clamp(Math.round(Number(source.pulseCount) || DEFAULT_SETTINGS.pulseCount), 1, 8),
      continuous: source.continuous == null ? DEFAULT_SETTINGS.continuous : !!source.continuous
    };
  }

  function mergeSettings(current, partial) {
    return normalizeSettings(Object.assign({}, current || {}, partial || {}));
  }

  function hexToRgb(hex) {
    const value = normalizeColor(hex).slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function channel(value) {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex) {
    const rgb = hexToRgb(hex);
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function contrastRatio(foreground, background) {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  function inkFor(hex) {
    const black = '#1B1404';
    const white = '#FFFFFF';
    return contrastRatio(black, hex) >= contrastRatio(white, hex) ? black : white;
  }

  function isSaturatedRed(hex) {
    const rgb = hexToRgb(hex);
    return rgb.r >= 180 && rgb.g <= 80 && rgb.b <= 80 && rgb.r - Math.max(rgb.g, rgb.b) >= 80;
  }

  function warningReasons(settings) {
    const safe = normalizeSettings(settings);
    const speedRisk = safe.intervalMs < 1000;
    const solidRisk = safe.style === 'solid' && safe.intensity >= 75;
    const brightnessRisk = safe.intensity >= 90;
    const continuousRisk = safe.continuous;
    const redRisk = isSaturatedRed(safe.color);
    return {
      speedRisk: speedRisk,
      solidRisk: solidRisk,
      brightnessRisk: brightnessRisk,
      continuousRisk: continuousRisk,
      redRisk: redRisk,
      show: speedRisk || solidRisk || brightnessRisk || continuousRisk || redRisk
    };
  }

  function warningText(settings) {
    const reasons = warningReasons(settings);
    if (!reasons.show) return '';
    const parts = [
      'Take care: rapid or high-contrast flashing can affect people with photosensitive epilepsy. Pulses stay at or below two per second.'
    ];
    if (reasons.speedRisk) parts.push('This speed is in the faster part of the range.');
    if (reasons.solidRisk) parts.push('A bright full-window flash covers a large area.');
    if (reasons.brightnessRisk) parts.push('Brightness is near the maximum.');
    if (reasons.continuousRisk) parts.push('Continuous flashing keeps going until you dismiss it.');
    if (reasons.redRisk) parts.push('Saturated red is harder on the eyes than amber or blue.');
    parts.push('A slower border pulse is the safer choice.');
    return parts.join(' ');
  }

  function stripMarker(title) {
    let value = typeof title === 'string' ? title : '';
    for (let guard = 0; guard < 5; guard += 1) {
      const prefix = value.startsWith(BRIGHT_PREFIX)
        ? BRIGHT_PREFIX
        : value.startsWith(DIM_PREFIX) ? DIM_PREFIX : '';
      if (!prefix) break;
      value = value.slice(prefix.length);
    }
    return value;
  }

  function monogramFor(title) {
    const trimmed = stripMarker(title).trim();
    if (!trimmed) return '?';
    return String.fromCodePoint(trimmed.codePointAt(0)).toLocaleUpperCase();
  }

  function markColorFor(title) {
    const text = stripMarker(title);
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return MARK_COLORS[hash % MARK_COLORS.length];
  }

  function isTabMuted(tab) {
    return !!(tab && tab.mutedInfo && tab.mutedInfo.muted);
  }

  function planFocusUpdates(tabs, listeningId, heldMuted) {
    const mute = [];
    const unmute = [];
    (tabs || []).forEach(function (tab) {
      if (!tab || tab.id == null) return;
      const muted = isTabMuted(tab);
      if (tab.id === listeningId) {
        if (!heldMuted && muted) unmute.push(tab.id);
      } else if (!muted) {
        mute.push(tab.id);
      }
    });
    return { mute: mute, unmute: unmute };
  }

  function planFocusRestore(tabs, preFocusMuted) {
    const saved = preFocusMuted && typeof preFocusMuted === 'object' ? preFocusMuted : {};
    const ops = [];
    (tabs || []).forEach(function (tab) {
      if (!tab || tab.id == null) return;
      const key = String(tab.id);
      if (!Object.prototype.hasOwnProperty.call(saved, key)) return;
      const wantMuted = !!saved[key];
      if (wantMuted !== isTabMuted(tab)) ops.push({ tabId: tab.id, muted: wantMuted });
    });
    return ops;
  }

  function audibleTabsToSilence(tabs, nextListeningId) {
    const ids = [];
    (tabs || []).forEach(function (tab) {
      if (!tab || tab.id == null || tab.id === nextListeningId) return;
      if (tab.audible && !isTabMuted(tab)) ids.push(tab.id);
    });
    return ids;
  }

  function buildWindowLabels(windows) {
    const list = Array.isArray(windows) ? windows : [];
    const labels = {};
    const normal = list.filter(function (win) { return win && win.type === 'normal'; })
      .sort(function (a, b) { return a.id - b.id; });
    normal.forEach(function (win, index) {
      const bits = ['Window ' + (index + 1)];
      if (win.incognito) bits.push('private');
      if (win.focused) bits.push('focused');
      labels[win.id] = bits.join(' · ');
    });
    list.forEach(function (win) {
      if (!win || labels[win.id]) return;
      if (win.type === 'popup') {
        labels[win.id] = win.focused ? 'Popup window · focused' : 'Popup window';
      } else {
        labels[win.id] = win.focused ? 'Other window · focused' : 'Other window';
      }
    });
    return labels;
  }

  function plural(count, noun) {
    return count + ' ' + noun + (count === 1 ? '' : 's');
  }

  function soundCounts(tabs) {
    let audible = 0;
    let playing = 0;
    (tabs || []).forEach(function (tab) {
      if (!tab || !tab.audible) return;
      audible += 1;
      if (!isTabMuted(tab)) playing += 1;
    });
    return { audible: audible, playing: playing, muted: audible - playing };
  }

  function badgeText(counts, flashingCount) {
    if (counts.audible > 99) return '99+';
    if (counts.audible > 0) return String(counts.audible);
    if (flashingCount > 0) return '!';
    return '';
  }

  function badgeTitle(counts, flashingCount) {
    let detail;
    if (counts.audible === 0) detail = 'no tabs producing sound';
    else if (counts.muted === 0) detail = plural(counts.audible, 'tab') + ' producing sound';
    else if (counts.playing === 0) detail = plural(counts.audible, 'tab') + ' producing sound, all muted';
    else {
      detail = plural(counts.audible, 'tab') + ' producing sound, ' +
        counts.playing + ' playing and ' + counts.muted + ' muted';
    }
    if (flashingCount > 0) detail += ', ' + plural(flashingCount, 'tab') + ' flashing';
    return 'Tab Noise Tracker — ' + detail;
  }

  function summaryText(tabs, context) {
    const counts = soundCounts(tabs);
    const flashingCount = context && context.flashingCount ? context.flashingCount : 0;
    const silencedCount = context && context.silencedCount ? context.silencedCount : 0;
    const parts = [];
    if (counts.audible === 0) {
      parts.push(silencedCount > 0
        ? plural(silencedCount, 'tab') + ' muted by Focus mode. None are producing sound now.'
        : 'No tabs are producing sound.');
    } else if (counts.muted === 0) {
      parts.push(plural(counts.audible, 'tab') + ' producing sound.');
    } else if (counts.playing === 0) {
      parts.push(plural(counts.audible, 'tab') + ' producing sound, all muted.');
    } else {
      parts.push(plural(counts.audible, 'tab') + ' producing sound, ' +
        counts.playing + ' playing and ' + counts.muted + ' muted.');
    }
    if (flashingCount > 0) parts.push(plural(flashingCount, 'tab') + ' flashing.');
    if (context && context.focusEnabled) parts.push('Focus mode is on.');
    return parts.join(' ');
  }

  function isActiveFlash(flash, now) {
    return !!(flash && Number(flash.until) > now);
  }

  function activeFlashes(flashing, now) {
    const active = {};
    const source = flashing && typeof flashing === 'object' ? flashing : {};
    Object.keys(source).forEach(function (id) {
      if (isActiveFlash(source[id], now)) active[id] = source[id];
    });
    return active;
  }

  function knownReason(reason) {
    if (reason === 'focus-mute' || reason === 'test' || reason === 'audible') return reason;
    return 'audible';
  }

  function statusLabel(flags) {
    if (flags.flashing && flags.flashReason === 'focus-mute') return 'Flashing. Focus mode muted this tab.';
    if (flags.flashing && flags.flashReason === 'test') return 'Flashing. This is a test.';
    if (flags.flashing) return 'Flashing. This tab started making sound.';
    if (flags.listening && flags.audible && !flags.muted) return 'Playing. Focus mode is letting this tab through.';
    if (flags.audible && !flags.muted) return 'Playing.';
    if (flags.listening && flags.audible && flags.muted) return 'Producing sound, and you muted the Focus tab.';
    if (flags.audible && flags.muted && flags.focusEnabled) return 'Producing sound, muted by Focus mode.';
    if (flags.audible && flags.muted) return 'Producing sound, but muted.';
    if (flags.silenced) return 'Muted by Focus mode.';
    return 'Marked.';
  }

  function pageNoteFor(code) {
    if (code === 'asleep') return 'This tab is asleep, so the page itself cannot flash until you open it.';
    if (code === 'browser') return 'This page cannot show an overlay. The toolbar still alerts you.';
    if (code === 'failed') return 'The page flash did not start. The toolbar still alerts you.';
    return '';
  }

  function flashDurationMs(settings, reducedMotion) {
    const safe = normalizeSettings(settings);
    if (safe.continuous && !reducedMotion) return CONTINUOUS_MS;
    if (reducedMotion) return HOLD_MS;
    return safe.pulseCount * safe.intervalMs + HOLD_MS;
  }

  function shouldStartAudibleAlert(lastAt, now) {
    if (!lastAt) return true;
    return now - lastAt >= COOLDOWN_MS;
  }

  function buildRows(input) {
    const tabs = input && input.tabs ? input.tabs : [];
    const now = input && input.now != null ? input.now : Date.now();
    const labels = buildWindowLabels(input && input.windows);
    const flashing = activeFlashes(input && input.flashing, now);
    const silenced = input && input.silenced && typeof input.silenced === 'object' ? input.silenced : {};
    const unsupported = input && input.unsupported && typeof input.unsupported === 'object' ? input.unsupported : {};
    const focusEnabled = !!(input && input.focusEnabled);
    const listeningTabId = input ? input.listeningTabId : null;
    const rows = [];

    tabs.forEach(function (tab) {
      if (!tab || tab.id == null) return;
      const key = String(tab.id);
      const flash = flashing[key];
      const silenceUntil = Number(silenced[key]);
      const silencedNow = Number.isFinite(silenceUntil) && silenceUntil > now;
      if (!tab.audible && !flash && !silencedNow) return;
      const title = stripMarker(tab.title || '') || 'Untitled tab';
      const windowLabel = labels[tab.windowId] || 'Window';
      const flags = {
        flashing: !!flash,
        flashReason: flash ? knownReason(flash.reason) : '',
        listening: focusEnabled && tab.id === listeningTabId,
        audible: !!tab.audible,
        muted: isTabMuted(tab),
        focusEnabled: focusEnabled,
        silenced: silencedNow
      };
      rows.push({
        tabId: tab.id,
        windowId: tab.windowId == null ? 0 : tab.windowId,
        title: title,
        monogram: monogramFor(title),
        markColor: markColorFor(title),
        windowLine: tab.discarded ? windowLabel + ' · asleep' : windowLabel,
        audible: flags.audible,
        muted: flags.muted,
        discarded: !!tab.discarded,
        flashing: flags.flashing,
        flashReason: flags.flashReason,
        listening: flags.listening,
        statusLabel: statusLabel(flags),
        pageNote: flags.flashing ? pageNoteFor(unsupported[key]) : '',
        showMeter: flags.audible && !flags.muted
      });
    });

    function rank(row) {
      if (row.flashing) return 0;
      if (row.audible && !row.muted) return 1;
      if (row.audible) return 2;
      return 3;
    }

    rows.sort(function (a, b) {
      return rank(a) - rank(b) ||
        a.windowId - b.windowId ||
        a.title.localeCompare(b.title) ||
        a.tabId - b.tabId;
    });
    return rows;
  }

  return {
    BRIGHT_PREFIX: BRIGHT_PREFIX,
    DIM_PREFIX: DIM_PREFIX,
    HOLD_MS: HOLD_MS,
    COOLDOWN_MS: COOLDOWN_MS,
    CONTINUOUS_MS: CONTINUOUS_MS,
    SILENCE_LIST_MS: SILENCE_LIST_MS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    COLOR_PRESETS: COLOR_PRESETS,
    MARK_COLORS: MARK_COLORS,
    BADGE_COLORS: BADGE_COLORS,
    normalizeSettings: normalizeSettings,
    mergeSettings: mergeSettings,
    hexToRgb: hexToRgb,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    inkFor: inkFor,
    isSaturatedRed: isSaturatedRed,
    warningReasons: warningReasons,
    warningText: warningText,
    stripMarker: stripMarker,
    monogramFor: monogramFor,
    markColorFor: markColorFor,
    isTabMuted: isTabMuted,
    planFocusUpdates: planFocusUpdates,
    planFocusRestore: planFocusRestore,
    audibleTabsToSilence: audibleTabsToSilence,
    buildWindowLabels: buildWindowLabels,
    soundCounts: soundCounts,
    badgeText: badgeText,
    badgeTitle: badgeTitle,
    summaryText: summaryText,
    activeFlashes: activeFlashes,
    statusLabel: statusLabel,
    pageNoteFor: pageNoteFor,
    flashDurationMs: flashDurationMs,
    shouldStartAudibleAlert: shouldStartAudibleAlert,
    buildRows: buildRows
  };
});
