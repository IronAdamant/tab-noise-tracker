'use strict';

/* Focus mode used to re-inject the content script while a title observer was
   still watching <head>. Each favicon rewrite prepended another speaker
   prefix, and the title grew without bound. This loads the real content
   script and service worker and checks that a long run does not do that. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ORIGINAL = "Fubuki's Mega Mix";

const observers = [];
const timers = [];
const runtimeListeners = [];
const updatedListeners = [];
let titleWrites = 0;
let pageTitle = ORIGINAL;
let peakObservers = 0;
let peakTimers = 0;
let nextTimer = 1;
let notifyRunning = false;

function connectedObservers() {
  const count = observers.filter(function (observer) { return observer.connected; }).length;
  if (count > peakObservers) peakObservers = count;
  return count;
}

function noteTimers() {
  if (timers.length > peakTimers) peakTimers = timers.length;
}

function MutationObserver(callback) {
  this.callback = callback;
  this.connected = false;
  observers.push(this);
}

MutationObserver.prototype.observe = function () {
  this.connected = true;
  connectedObservers();
};

MutationObserver.prototype.disconnect = function () {
  this.connected = false;
};

function notifyObservers() {
  if (notifyRunning) return;
  notifyRunning = true;
  try {
    let guard = 0;
    let progressed = true;
    while (progressed && guard < 25) {
      progressed = false;
      guard += 1;
      observers.slice().forEach(function (observer) {
        if (!observer.connected) return;
        const before = titleWrites;
        observer.callback([]);
        if (titleWrites !== before) progressed = true;
      });
      if (guard >= 25 && progressed) {
        throw new Error('Title observer kept rewriting document.title');
      }
    }
  } finally {
    notifyRunning = false;
  }
}

function element(tag) {
  const attrs = {};
  const node = {
    tagName: String(tag).toUpperCase(),
    attributes: [],
    children: [],
    parentNode: null,
    style: { setProperty: function () {} },
    setAttribute: function (name, value) {
      attrs[name] = String(value);
      node.attributes = Object.keys(attrs).map(function (key) {
        return { name: key, value: attrs[key] };
      });
      notifyObservers();
    },
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    appendChild: function (child) {
      if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
      child.parentNode = node;
      node.children.push(child);
      notifyObservers();
      return child;
    },
    removeChild: function (child) {
      const index = node.children.indexOf(child);
      if (index >= 0) node.children.splice(index, 1);
      child.parentNode = null;
      notifyObservers();
    },
    remove: function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    },
    getContext: function () {
      return {
        fillStyle: '',
        clearRect: function () {},
        beginPath: function () {},
        moveTo: function () {},
        arcTo: function () {},
        closePath: function () {},
        fill: function () {}
      };
    },
    toDataURL: function () {
      return 'data:image/png;base64,ICON';
    }
  };
  return node;
}

function walk(node, visit) {
  node.children.forEach(function (child) {
    visit(child);
    walk(child, visit);
  });
}

function matches(node, selector) {
  const match = /^(\w+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(selector);
  if (!match) throw new Error('Unsupported selector ' + selector);
  if (node.tagName !== match[1].toUpperCase()) return false;
  if (match[2] && node.getAttribute(match[2]) !== match[3]) return false;
  return true;
}

function queryAll(selector) {
  const found = [];
  walk(document.documentElement, function (node) {
    if (matches(node, selector)) found.push(node);
  });
  return found;
}

const html = element('html');
const head = element('head');
html.appendChild(head);
head.appendChild(element('link')).setAttribute('rel', 'icon');
head.children[0].setAttribute('href', '/fav.ico');

const document = {
  documentElement: html,
  head: head,
  createElement: element,
  querySelectorAll: queryAll,
  querySelector: function (selector) { return queryAll(selector)[0] || null; },
  getElementById: function () { return null; }
};
Object.defineProperty(document, 'title', {
  configurable: true,
  get: function () { return pageTitle; },
  set: function (value) {
    titleWrites += 1;
    pageTitle = String(value);
  }
});

global.document = document;
global.window = global;
global.location = { protocol: 'https:' };
global.MutationObserver = MutationObserver;
global.matchMedia = function () { return { matches: false }; };

global.setTimeout = function (fn) {
  const id = nextTimer;
  nextTimer += 1;
  timers.push({ id: id, fn: fn });
  noteTimers();
  return id;
};
global.clearTimeout = function (id) {
  const index = timers.findIndex(function (timer) { return timer.id === id; });
  if (index >= 0) timers.splice(index, 1);
};

function flushTimers(max) {
  let steps = 0;
  const limit = max || 40;
  while (timers.length && steps < limit) {
    const timer = timers.shift();
    steps += 1;
    timer.fn();
    noteTimers();
  }
  if (timers.length && steps >= limit) {
    throw new Error('Timers kept rescheduling (' + timers.length + ' still queued)');
  }
}

function evalScript(relativePath) {
  const file = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

const tabs = [
  {
    id: 1,
    windowId: 1,
    active: true,
    audible: true,
    discarded: false,
    status: 'complete',
    title: ORIGINAL,
    url: 'https://example.test/watch',
    mutedInfo: { muted: false, reason: 'user' }
  },
  {
    id: 2,
    windowId: 1,
    active: false,
    audible: true,
    discarded: false,
    status: 'complete',
    title: 'Ad slot',
    url: 'https://example.test/ad',
    mutedInfo: { muted: false, reason: 'user' }
  }
];

const storage = {
  local: {
    settings: {
      titleMarker: true,
      overlay: false,
      toolbar: true,
      flashOnFocusMute: true
    }
  },
  session: {}
};
let chromeCalls = 0;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function noteCall() {
  chromeCalls += 1;
  if (chromeCalls > 5000) throw new Error('Chrome API calls ran away');
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
    onMessage: {
      addListener: function (fn) {
        runtimeListeners.push(fn);
      }
    },
    sendMessage: function (message) {
      noteCall();
      runtimeListeners.forEach(function (fn) {
        fn(message, { tab: { id: 2 } }, function () {});
      });
      return Promise.resolve();
    }
  },
  action: {
    setIcon: function () { noteCall(); return Promise.resolve(); },
    setBadgeBackgroundColor: function () { noteCall(); return Promise.resolve(); },
    setBadgeTextColor: function () { noteCall(); return Promise.resolve(); },
    setBadgeText: function () { noteCall(); return Promise.resolve(); },
    setTitle: function () { noteCall(); return Promise.resolve(); }
  },
  notifications: {
    getPermissionLevel: function (callback) { callback('granted'); },
    create: function () { noteCall(); return Promise.resolve(); },
    clear: function () { noteCall(); return Promise.resolve(); },
    onClicked: { addListener: function () {} }
  },
  storage: {
    onChanged: { addListener: function () {} },
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
    query: function (info) {
      noteCall();
      return Promise.resolve(tabs.filter(function (tab) {
        if (info && info.active != null && !!tab.active !== !!info.active) return false;
        if (info && info.windowId != null && tab.windowId !== info.windowId) return false;
        if (info && info.lastFocusedWindow && !tab.active) return false;
        return true;
      }).map(clone));
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
    sendMessage: function (id, message) {
      noteCall();
      let response;
      // tabs.sendMessage reaches the content script, not the service worker.
      if (runtimeListeners[0]) {
        runtimeListeners[0](message, { tab: { id: id } }, function (value) { response = value; });
      }
      return Promise.resolve(response);
    },
    onUpdated: { addListener: function (fn) { updatedListeners.push(fn); } },
    onActivated: { addListener: function () {} },
    onCreated: { addListener: function () {} },
    onRemoved: { addListener: function () {} }
  },
  scripting: {
    executeScript: function () {
      noteCall();
      evalScript('shared/tracker_model.js');
      evalScript('content/visual_alert.js');
      return Promise.resolve([]);
    }
  },
  commands: { onCommand: { addListener: function () {} } }
};

global.chrome = chrome;
global.importScripts = function () {
  for (let index = 0; index < arguments.length; index += 1) evalScript(arguments[index]);
};

function deliverUpdates() {
  const batch = pendingUpdated.splice(0, pendingUpdated.length);
  batch.forEach(function (args) {
    updatedListeners.forEach(function (fn) { fn(args[0], args[1], args[2]); });
  });
}

function settle() {
  return new Promise(function (resolve, reject) {
    let spins = 0;
    let quiet = 0;
    function spin() {
      try {
        deliverUpdates();
        flushTimers(40);
        spins += 1;
        if (spins > 40) {
          reject(new Error('Focus work did not settle (' + timers.length + ' timers left)'));
          return;
        }
        setImmediate(function () {
          if (pendingUpdated.length || timers.length) {
            quiet = 0;
            spin();
            return;
          }
          quiet += 1;
          if (quiet < 4) spin();
          else resolve();
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

function assertTitleHeld(label) {
  assert.strictEqual(pageTitle, ORIGINAL, label + ' changed the page title to ' + pageTitle);
  assert.strictEqual(titleWrites, 0, label + ' wrote document.title ' + titleWrites + ' times');
  assert.ok(connectedObservers() <= 1, label + ' left ' + connectedObservers() + ' observers connected');
  assert.ok(peakObservers <= 1, label + ' peaked at ' + peakObservers + ' observers');
}

evalScript('shared/tracker_model.js');
evalScript('content/visual_alert.js');
assert.strictEqual(runtimeListeners.length, 1);

const legacySettings = { titleMarker: true, faviconFlash: true, toolbar: false, overlay: false };
for (let cycle = 0; cycle < 8; cycle += 1) {
  evalScript('content/visual_alert.js');
  const started = TabNoiseVisual.start(legacySettings, cycle % 2 === 0 ? 'focus-mute' : 'audible');
  assert.strictEqual(started, true);
  assert.ok(timers.length <= 2, 'alert cycle ' + cycle + ' queued ' + timers.length + ' timers');
  assertTitleHeld('alert cycle ' + cycle);
}
assert.strictEqual(runtimeListeners.length, 1, 're-injection added a content listener');
flushTimers(40);
assert.strictEqual(timers.length, 0);
assertTitleHeld('after alert timers drained');
TabNoiseVisual.stop(true);
assert.strictEqual(connectedObservers(), 0);

evalScript('background.js');
assert.strictEqual(updatedListeners.length, 1);
assert.strictEqual(runtimeListeners.length, 2);

settle().then(function () {
  assert.strictEqual(Object.prototype.hasOwnProperty.call(storage.local.settings, 'titleMarker'), false);
  assert.strictEqual(storage.local.settings.faviconFlash, true);
  const listenersAfterInit = runtimeListeners.length;
  const updatedAfterInit = updatedListeners.length;
  const enableCounts = [];
  const disableCounts = [];

  function toggle(enabled) {
    const before = chromeCalls;
    return send({ type: 'tn-focus', enabled: enabled }).then(function (response) {
      assert.strictEqual(response.ok, true);
      assert.strictEqual(response.focusEnabled, enabled);
      return settle().then(function () {
        const delta = chromeCalls - before;
        assert.ok(delta < 200, 'focus ' + (enabled ? 'on' : 'off') + ' made ' + delta + ' Chrome calls');
        if (enabled) enableCounts.push(delta);
        else disableCounts.push(delta);
      });
    });
  }

  let chain = Promise.resolve();
  for (let round = 0; round < 4; round += 1) {
    chain = chain.then(function () { return toggle(round % 2 === 0); });
  }
  return chain.then(function () {
    assert.ok(enableCounts[1] <= enableCounts[0] + 8, 'enabling Focus grew from ' + enableCounts[0] + ' to ' + enableCounts[1] + ' calls');
    assert.ok(disableCounts[1] <= disableCounts[0] + 8, 'disabling Focus grew from ' + disableCounts[0] + ' to ' + disableCounts[1] + ' calls');
    assert.strictEqual(runtimeListeners.length, listenersAfterInit);
    assert.strictEqual(updatedListeners.length, updatedAfterInit);
    assert.strictEqual(timers.length, 0);
    assert.strictEqual(storage.local.focusEnabled, false);
    assertTitleHeld('focus off/on/off/on');
    console.log('focus leak tests passed');
  });
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
