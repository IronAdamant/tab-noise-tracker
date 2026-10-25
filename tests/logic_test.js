'use strict';

const assert = require('assert');
const Model = require('../shared/tracker_model.js');

function tab(partial) {
  return Object.assign({
    id: 1,
    windowId: 1,
    title: 'Example',
    audible: false,
    discarded: false,
    mutedInfo: { muted: false, reason: 'user' }
  }, partial);
}

function testSettings() {
  const defaults = Model.normalizeSettings(null);
  assert.deepStrictEqual(defaults, Model.DEFAULT_SETTINGS);
  assert.strictEqual(defaults.intervalMs >= 1000, true, 'default pulse is at most one per second');
  assert.strictEqual(defaults.style, 'border');
  assert.strictEqual(Model.warningText(defaults), '');

  const clamped = Model.normalizeSettings({
    intensity: 1000,
    intervalMs: 50,
    pulseCount: 0,
    style: 'nope',
    color: 'red',
    overlay: false
  });
  assert.strictEqual(clamped.intensity, 100);
  assert.strictEqual(clamped.intervalMs, 500);
  assert.strictEqual(clamped.pulseCount, 4);
  assert.strictEqual(clamped.style, 'border');
  assert.strictEqual(clamped.color, Model.DEFAULT_SETTINGS.color);
  assert.strictEqual(clamped.overlay, false);
  assert.strictEqual(clamped.titleMarker, true);

  const merged = Model.mergeSettings(clamped, { tabAlerts: true, intervalMs: 1490 });
  assert.strictEqual(merged.overlay, false);
  assert.strictEqual(merged.tabAlerts, true);
  assert.strictEqual(merged.intervalMs, 1500);

  assert.strictEqual(Model.warningReasons({
    style: 'solid',
    intensity: 80,
    intervalMs: 500,
    continuous: true,
    color: '#FF0000'
  }).show, true);
  assert.strictEqual(Model.isSaturatedRed('#FF0000'), true);
  assert.strictEqual(Model.isSaturatedRed('#E08900'), false);
  assert.ok(Model.warningText({ intervalMs: 500 }).includes('photosensitive'));
}

function testContrast() {
  const samples = Model.COLOR_PRESETS.map(function (preset) { return preset.value; })
    .concat([Model.BADGE_COLORS.playing, Model.BADGE_COLORS.muted, Model.BADGE_COLORS.quiet, '#FFFFFF']);
  samples.forEach(function (color) {
    const ink = Model.inkFor(color);
    const ratio = Model.contrastRatio(ink, color);
    assert.ok(ratio >= 4.5, color + ' contrast ' + ratio.toFixed(2) + ' with ' + ink);
  });
  Model.MARK_COLORS.forEach(function (color) {
    const ratio = Model.contrastRatio('#FFFFFF', color);
    assert.ok(ratio >= 4.5, 'mark ' + color + ' contrast ' + ratio.toFixed(2));
  });
}

function testFocusPlans() {
  const tabs = [
    tab({ id: 1, mutedInfo: { muted: true } }),
    tab({ id: 2, audible: true }),
    tab({ id: 3, audible: true, mutedInfo: { muted: true } })
  ];
  const plan = Model.planFocusUpdates(tabs, 1, false);
  assert.deepStrictEqual(plan.unmute, [1]);
  assert.deepStrictEqual(plan.mute, [2]);

  const held = Model.planFocusUpdates(tabs, 1, true);
  assert.deepStrictEqual(held.unmute, []);
  assert.deepStrictEqual(held.mute, [2]);

  const restore = Model.planFocusRestore([
    tab({ id: 2, mutedInfo: { muted: true } }),
    tab({ id: 9, mutedInfo: { muted: false } })
  ], { 2: false, 9: true, 4: false });
  assert.deepStrictEqual(restore, [
    { tabId: 2, muted: false },
    { tabId: 9, muted: true }
  ]);

  assert.deepStrictEqual(Model.audibleTabsToSilence(tabs, 2), []);
  assert.deepStrictEqual(Model.audibleTabsToSilence(tabs, 1), [2]);
}

function testRowsAndBadge() {
  assert.strictEqual(Model.stripMarker('🔊 🔈 Hello'), 'Hello');
  assert.strictEqual(Model.monogramFor('🔊 beta'), 'B');

  const now = 100000;
  const windows = [
    { id: 2, type: 'normal', focused: true, incognito: false },
    { id: 1, type: 'normal', focused: false, incognito: true }
  ];
  assert.strictEqual(Model.buildWindowLabels(windows)[1], 'Window 1 · private');
  assert.strictEqual(Model.buildWindowLabels(windows)[2], 'Window 2 · focused');

  const rows = Model.buildRows({
    now: now,
    windows: windows,
    focusEnabled: true,
    listeningTabId: 2,
    flashing: {
      5: { reason: 'focus-mute', until: now + 1000 },
      6: { reason: 'audible', until: now - 1 }
    },
    silenced: { 7: now + 5000, 8: now - 5 },
    unsupported: { 5: 'browser' },
    tabs: [
      tab({ id: 2, windowId: 2, title: '🔊 Video', audible: true }),
      tab({ id: 3, windowId: 1, title: 'Ad', audible: true, mutedInfo: { muted: true } }),
      tab({ id: 4, windowId: 2, title: 'Quiet' }),
      tab({ id: 5, windowId: 2, title: 'Old song', audible: false }),
      tab({ id: 7, windowId: 1, title: 'Silenced', discarded: true }),
      tab({ id: 8, windowId: 1, title: 'Expired' })
    ]
  });

  assert.deepStrictEqual(rows.map(function (row) { return row.tabId; }), [5, 2, 3, 7]);
  assert.strictEqual(rows[0].statusLabel, 'Flashing. Focus mode muted this tab.');
  assert.strictEqual(rows[0].pageNote.includes('overlay'), true);
  assert.strictEqual(rows[1].title, 'Video');
  assert.strictEqual(rows[1].statusLabel, 'Playing. Focus mode is letting this tab through.');
  assert.strictEqual(rows[1].showMeter, true);
  assert.strictEqual(rows[2].statusLabel, 'Producing sound, muted by Focus mode.');
  assert.strictEqual(rows[3].windowLine, 'Window 1 · private · asleep');
  assert.strictEqual(rows[3].statusLabel, 'Muted by Focus mode.');

  const counts = Model.soundCounts([
    tab({ audible: true }),
    tab({ audible: true, mutedInfo: { muted: true } }),
    tab({ audible: false })
  ]);
  assert.deepStrictEqual(counts, { audible: 2, playing: 1, muted: 1 });
  assert.strictEqual(Model.badgeText(counts, 0), '2');
  assert.strictEqual(Model.badgeText({ audible: 0, playing: 0, muted: 0 }, 1), '!');
  assert.strictEqual(Model.badgeText({ audible: 120, playing: 1, muted: 119 }, 0), '99+');
  assert.strictEqual(
    Model.badgeTitle(counts, 1),
    'Tab Noise Tracker — 2 tabs producing sound, 1 playing and 1 muted, 1 tab flashing'
  );
  assert.strictEqual(
    Model.summaryText([tab({ audible: true })], { focusEnabled: true, flashingCount: 0, silencedCount: 0 }),
    '1 tab producing sound. Focus mode is on.'
  );
  assert.strictEqual(Model.shouldStartAudibleAlert(1000, 5999), false);
  assert.strictEqual(Model.shouldStartAudibleAlert(1000, 6000), true);
  assert.strictEqual(Model.flashDurationMs(Model.DEFAULT_SETTINGS, false), 4 * 1500 + Model.HOLD_MS);
  assert.strictEqual(Model.flashDurationMs(Model.DEFAULT_SETTINGS, true), Model.HOLD_MS);
  assert.strictEqual(Model.flashDurationMs({ continuous: true }, false), Model.CONTINUOUS_MS);
}

function testLabels() {
  assert.strictEqual(Model.statusLabel({ flashing: true, flashReason: 'test' }), 'Flashing. This is a test.');
  assert.strictEqual(Model.statusLabel({
    audible: true,
    muted: true,
    listening: true
  }), 'Producing sound, and you muted the Focus tab.');
  assert.strictEqual(Model.pageNoteFor('asleep').includes('asleep'), true);
  assert.strictEqual(Model.pageNoteFor(''), '');
}

testSettings();
testContrast();
testFocusPlans();
testRowsAndBadge();
testLabels();
console.log('logic tests passed');
