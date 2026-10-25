'use strict';

/* Visual alerts master switch: upgrades turn it on, and while it is off an
   audible tab and a Focus mute do not inject a flash or pulse the toolbar.
   The tab list and Focus mute still run. Test flash is a manual preview. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const Model = require('../shared/tracker_model.js');

const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert.strictEqual(manifest.version, '1.0.3');
const alertsAt = popup.indexOf('id="alerts-toggle"');
const focusAt = popup.indexOf('id="focus-toggle"');
assert.ok(alertsAt !== -1 && focusAt !== -1 && alertsAt < focusAt, 'visual alerts toggle sits above Focus mode');
assert.ok(popup.indexOf("Flash the tab that's making sound.") !== -1);
assert.ok(
  optionsHtml.indexOf('id="visual-alerts"') !== -1 &&
  optionsHtml.indexOf('id="visual-alerts"') < optionsHtml.indexOf('id="favicon-flash"'),
  'options master switch sits above the per-surface switches'
);

const timers = [];
let nextTimer = 1;
global.setTimeout = function (fn) {
  const id = nextTimer;
  nextTimer += 1;
  timers.push({ id: id, fn: fn });
  return id;
};
global.clearTimeout = function (id) {
  const index = timers.findIndex(function (timer) { return timer.id === id; });
  if (index >= 0) timers.splice(index, 1);
};

const runtimeListeners = [];
const updatedListeners = [];
const storageListeners = [];
const iconPaths = [];
const badgeTexts = [];
let scriptCalls = 0;
let chromeCalls = 0;

const tabs = [
  {
    id: 1,
    windowId: 1,
    active: true,
    audible: false,
    discarded: false,
    status: 'complete',
    title: 'Quiet',
    url: 'https://example.test/quiet',
    mutedInfo: { muted: false, reason: 'user' }
  },
  {
    id: 2,
    windowId: 1,
    active: false,
    audible: false,
    discarded: false,
    status: 'complete',
    title: 'Video',
    url: 'https://example.test/watch',
    mutedInfo: { muted: false, reason: 'user' }
  }
];

const storage = {
  local: {
    settings: {
      faviconFlash: false,
      toolbar: true,
      overlay: true,
      flashOnFocusMute: true,
      tabAlerts: false
    }
  },
  session: {}
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function noteCall() {
  chromeCalls += 1;
  if (chromeCalls > 5000) throw new Error('Chrome API calls ran away');
}

function sawAlertIcon() {
  return iconPaths.some(function (iconPath) {
    return JSON.stringify(iconPath || {}).indexOf('alert') !== -1;
  });
}

function flashingIds() {
  return Object.keys(storage.session.flashing || {});
}

const pendingUpdated = [];

const chrome = {
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: { addListener: function () {} },
    update: function () { noteCall(); return Promise.resolve(); }
  },
  runtime: {
    getURL: function (file) { return 'chrome-extension://test/' + file; },
    onMessage: { addListener: function (fn) { runtimeListeners.push(fn); } },
    sendMessage: function () { noteCall(); return Promise.resolve(); }
  },
  action: {
    setIcon: function (details) {
      noteCall();
      iconPaths.push(details && details.path);
      return Promise.resolve();
    },
    setBadgeBackgroundColor: function () { noteCall(); return Promise.resolve(); },
    setBadgeTextColor: function () { noteCall(); return Promise.resolve(); },
    setBadgeText: function (details) {
      noteCall();
      badgeTexts.push(details && details.text);
      return Promise.resolve();
    },
    setTitle: function () { noteCall(); return Promise.resolve(); }
  },
  notifications: {
    getPermissionLevel: function (callback) { callback('denied'); },
    create: function () { noteCall(); return Promise.resolve(); },
    clear: function () { noteCall(); return Promise.resolve(); },
    onClicked: { addListener: function () {} }
  },
  storage: {
    onChanged: { addListener: function (fn) { storageListeners.push(fn); } },
    local: {
      get: function (keys) {
        noteCall();
        if (keys == null) return Promise.resolve(clone(storage.local));
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(storage.local, key)) out[key] = clone(storage.local[key]);
        });
        return Promise.resolve(out);
      },
      set: function (obj) {
        noteCall();
        Object.keys(obj).forEach(function (key) { storage.local[key] = clone(obj[key]); });
        return Promise.resolve();
      }
    },
    session: {
      get: function (keys) {
        noteCall();
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(storage.session, key)) out[key] = clone(storage.session[key]);
        });
        return Promise.resolve(out);
      },
      set: function (obj) {
        noteCall();
        Object.keys(obj).forEach(function (key) { storage.session[key] = clone(obj[key]); });
        return Promise.resolve();
      }
    }
  },
  tabs: {
    query: function () {
      noteCall();
      return Promise.resolve(tabs.map(clone));
    },
    get: function (id) {
      noteCall();
      const tab = tabs.find(function (item) { return item.id === id; });
      return tab ? Promise.resolve(clone(tab)) : Promise.reject(new Error('No tab'));
    },
    update: function (id, props) {
      noteCall();
      const tab = tabs.find(function (item) { return item.id === id; });
      if (!tab) return Promise.reject(new Error('No tab'));
      if (props && Object.prototype.hasOwnProperty.call(props, 'muted')) {
        tab.mutedInfo = { muted: !!props.muted, reason: 'extension' };
        pendingUpdated.push([id, { mutedInfo: clone(tab.mutedInfo) }, clone(tab)]);
      }
      return Promise.resolve(clone(tab));
    },
    sendMessage: function () { noteCall(); return Promise.resolve(); },
    onUpdated: { addListener: function (fn) { updatedListeners.push(fn); } },
    onActivated: { addListener: function () {} },
    onCreated: { addListener: function () {} },
    onRemoved: { addListener: function () {} }
  },
  scripting: {
    executeScript: function () {
      noteCall();
      scriptCalls += 1;
      return Promise.reject(new Error('injection counted'));
    }
  },
  commands: { onCommand: { addListener: function () {} } }
};

global.chrome = chrome;
global.importScripts = function () {
  for (let index = 0; index < arguments.length; index += 1) {
    const file = path.join(root, arguments[index]);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
};

function deliverUpdates() {
  const batch = pendingUpdated.splice(0, pendingUpdated.length);
  batch.forEach(function (args) {
    updatedListeners.forEach(function (fn) { fn(args[0], args[1], args[2]); });
  });
}

function quiet() {
  return new Promise(function (resolve, reject) {
    let last = -1;
    let stable = 0;
    let spins = 0;
    function spin() {
      try {
        deliverUpdates();
        spins += 1;
        if (spins > 80) {
          reject(new Error('did not settle (' + chromeCalls + ' calls, ' + timers.length + ' timers)'));
          return;
        }
        setImmediate(function () {
          if (chromeCalls === last && pendingUpdated.length === 0) {
            stable += 1;
            if (stable >= 4) resolve();
            else spin();
          } else {
            last = chromeCalls;
            stable = 0;
            spin();
          }
        });
      } catch (error) {
        reject(error);
      }
    }
    spin();
  });
}

function send(message) {
  return new Promise(function (resolve) {
    const background = runtimeListeners[runtimeListeners.length - 1];
    background(message, {}, function (response) { resolve(response); });
  });
}

function setAudible(id, audible) {
  const tab = tabs.find(function (item) { return item.id === id; });
  tab.audible = audible;
  updatedListeners.forEach(function (fn) {
    fn(id, { audible: audible }, clone(tab));
  });
}

function changeSettings(partial) {
  const oldValue = clone(storage.local.settings);
  const next = Model.mergeSettings(oldValue, partial);
  storage.local.settings = next;
  storageListeners.forEach(function (fn) {
    fn({ settings: { oldValue: oldValue, newValue: clone(next) } }, 'local');
  });
}

function tabById(id) {
  return tabs.find(function (item) { return item.id === id; });
}

global.importScripts('background.js');

quiet().then(function () {
  assert.strictEqual(storage.local.settings.visualAlerts, true, 'missing visualAlerts is migrated on');
  assert.strictEqual(storage.local.settings.faviconFlash, false, 'saved favicon switch stays off');
  assert.strictEqual(storage.local.settings.overlay, true, 'saved overlay switch stays on');
  assert.strictEqual(storage.local.settings.toolbar, true);
  assert.strictEqual(storage.local.settings.flashOnFocusMute, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(storage.local.settings, 'titleMarker'), false);

  changeSettings({ visualAlerts: false });
  return quiet();
}).then(function () {
  assert.strictEqual(storage.local.settings.visualAlerts, false);
  const before = scriptCalls;
  iconPaths.length = 0;
  setAudible(2, true);
  return quiet().then(function () {
    assert.strictEqual(scriptCalls, before, 'audible tab injected a flash while visual alerts were off');
    assert.deepStrictEqual(flashingIds(), [], 'audible tab recorded a flash while visual alerts were off');
    assert.strictEqual(sawAlertIcon(), false, 'toolbar flashed while visual alerts were off');
    assert.strictEqual(badgeTexts[badgeTexts.length - 1], '1', 'badge still counts the audible tab');
    assert.strictEqual(storage.local.settings.visualAlerts, false, 'an audible event rewrote the saved switch');
    const rows = Model.buildRows({
      now: Date.now(),
      windows: [{ id: 1, type: 'normal', focused: true }],
      tabs: tabs
    });
    assert.deepStrictEqual(rows.map(function (row) { return row.tabId; }), [2]);
    return send({ type: 'tn-focus', enabled: true });
  }).then(function (response) {
    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.focusEnabled, true);
    return quiet();
  }).then(function () {
    assert.strictEqual(tabById(2).mutedInfo.muted, true, 'Focus mode still mutes the other tab');
    assert.strictEqual(tabById(2).audible, true);
    assert.strictEqual(scriptCalls, before, 'Focus mute injected a flash while visual alerts were off');
    assert.ok(flashingIds().indexOf('2') === -1, 'Focus mute recorded a flash while visual alerts were off');
    const rows = Model.buildRows({
      now: Date.now(),
      windows: [{ id: 1, type: 'normal', focused: true }],
      focusEnabled: true,
      listeningTabId: 1,
      tabs: tabs
    });
    const noisy = rows.filter(function (row) { return row.tabId === 2; })[0];
    assert.ok(noisy && noisy.audible && noisy.muted, 'popup rows still list the muted noisy tab');

    iconPaths.length = 0;
    return send({
      type: 'tn-test-flash',
      tabId: 1,
      pageDriven: false,
      settings: storage.local.settings
    });
  }).then(function (response) {
    assert.strictEqual(response.ok, true, response && response.error);
    return quiet();
  }).then(function () {
    assert.ok(flashingIds().indexOf('1') !== -1, 'Test flash did not start');
    assert.strictEqual(scriptCalls, before, 'Test flash injected a content script');
    assert.strictEqual(sawAlertIcon(), true, 'Test flash did not preview the toolbar');
    assert.strictEqual(storage.local.settings.visualAlerts, false, 'Test flash turned visual alerts back on');
    return send({ type: 'tn-dismiss', tabId: 1 });
  }).then(function () {
    return quiet();
  }).then(function () {
    return send({ type: 'tn-focus', enabled: false });
  }).then(function (response) {
    assert.strictEqual(response.ok, true);
    return quiet();
  }).then(function () {
    assert.strictEqual(storage.local.focusEnabled, false);
    assert.strictEqual(scriptCalls, before);
    changeSettings({ visualAlerts: true, faviconFlash: true });
    setAudible(2, false);
    return quiet();
  }).then(function () {
    setAudible(2, true);
    return quiet();
  }).then(function () {
    assert.ok(scriptCalls > before, 'visual alerts on did not inject the flash script');
    assert.ok(flashingIds().indexOf('2') !== -1, 'visual alerts on did not record a flash');
    const injected = scriptCalls;
    changeSettings({ visualAlerts: false });
    return quiet().then(function () {
      assert.deepStrictEqual(flashingIds(), [], 'turning visual alerts off left a flash running');
      assert.strictEqual(scriptCalls, injected);
      if (storage.session.cooldown) delete storage.session.cooldown;
      setAudible(2, false);
      return quiet();
    }).then(function () {
      setAudible(2, true);
      return quiet();
    }).then(function () {
      assert.strictEqual(scriptCalls, injected, 'a later audible tab injected a flash while visual alerts were off');
      assert.deepStrictEqual(flashingIds(), []);
      console.log('visual alerts gate tests passed');
    });
  });
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
