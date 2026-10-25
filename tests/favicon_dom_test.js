'use strict';

/* Dependency-free stand-in for the tab document. Exercises the real favicon
   swap in content/visual_alert.js: capture, pulse, lazy replace, and restore. */

const assert = require('assert');

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
    },
    getAttribute: function (name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    appendChild: function (child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild: function (child) {
      const index = node.children.indexOf(child);
      if (index >= 0) node.children.splice(index, 1);
      child.parentNode = null;
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
      element.images += 1;
      return 'data:image/png;base64,ICON' + element.images;
    }
  };
  return node;
}

element.images = 0;

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

let pageTitle = 'Fixture';
const document = {
  documentElement: html,
  head: head,
  createElement: element,
  querySelectorAll: queryAll,
  querySelector: function (selector) {
    return queryAll(selector)[0] || null;
  },
  getElementById: function () { return null; }
};
Object.defineProperty(document, 'title', {
  configurable: true,
  get: function () { return pageTitle; },
  set: function (value) { pageTitle = String(value); }
});

const observers = [];
function MutationObserver(callback) {
  this.callback = callback;
  this.connected = false;
  observers.push(this);
}
MutationObserver.prototype.observe = function () { this.connected = true; };
MutationObserver.prototype.disconnect = function () { this.connected = false; };

function flushObservers() {
  observers.slice().forEach(function (observer) {
    if (observer.connected) observer.callback([]);
  });
}

global.document = document;
global.window = global;
global.location = { protocol: 'https:' };
global.chrome = {
  runtime: {
    sendMessage: function () {},
    onMessage: { addListener: function () {} }
  }
};
global.MutationObserver = MutationObserver;

let reduceMotion = false;
global.matchMedia = function () {
  return { matches: reduceMotion };
};

const realSetTimeout = global.setTimeout;
let timeoutCalls = 0;
global.setTimeout = function (fn, delay) {
  timeoutCalls += 1;
  return realSetTimeout(fn, delay);
};

require('../shared/tracker_model.js');
require('../content/visual_alert.js');

function link(rel, href, extra) {
  const node = element('link');
  node.setAttribute('rel', rel);
  if (href != null) node.setAttribute('href', href);
  Object.keys(extra || {}).forEach(function (name) {
    node.setAttribute(name, extra[name]);
  });
  head.appendChild(node);
  return node;
}

function iconHrefs() {
  return queryAll('link').filter(function (node) {
    return node.getAttribute('data-tn-favicon') !== 'pulse' &&
      TabNoiseModel.isFaviconRel(node.getAttribute('rel'));
  }).map(function (node) {
    return node.getAttribute('rel') + ' ' + node.getAttribute('href');
  });
}

function pulseLinks() {
  return queryAll('link').filter(function (node) {
    return node.getAttribute('data-tn-favicon') === 'pulse';
  });
}

function settings(partial) {
  return TabNoiseModel.normalizeSettings(Object.assign({
    faviconFlash: true,
    titleMarker: false,
    toolbar: false,
    overlay: false
  }, partial || {}));
}

function clearHead() {
  head.children.slice().forEach(function (child) { head.removeChild(child); });
}

function testRestoreExact() {
  clearHead();
  reduceMotion = false;
  timeoutCalls = 0;
  const sheet = link('stylesheet', 'app.css');
  link('shortcut icon', '/fav.ico', { type: 'image/png', sizes: '32x32' });
  link('apple-touch-icon', 'touch.png');
  const before = iconHrefs();

  assert.strictEqual(TabNoiseVisual.start(settings(), 'audible'), true);
  assert.deepStrictEqual(iconHrefs(), []);
  assert.strictEqual(queryAll('div').length, 0);
  assert.strictEqual(pulseLinks().length, 1);
  assert.ok(pulseLinks()[0].getAttribute('href').indexOf('data:image/png') === 0);
  assert.strictEqual(sheet.parentNode, head);

  TabNoiseVisual.stop(true);
  assert.deepStrictEqual(iconHrefs(), before);
  assert.strictEqual(pulseLinks().length, 0);
  assert.strictEqual(queryAll('link[rel="stylesheet"]').length, 1);
  const restored = queryAll('link').filter(function (node) {
    return node.getAttribute('rel') === 'shortcut icon';
  })[0];
  assert.strictEqual(restored.getAttribute('href'), '/fav.ico');
  assert.strictEqual(restored.getAttribute('type'), 'image/png');
  assert.strictEqual(restored.getAttribute('sizes'), '32x32');

  assert.strictEqual(TabNoiseVisual.start(settings(), 'audible'), true);
  TabNoiseVisual.stop(true);
  TabNoiseVisual.stop(true);
  assert.deepStrictEqual(iconHrefs(), before);
  assert.strictEqual(pulseLinks().length, 0);
}

function testNoFavicon() {
  clearHead();
  reduceMotion = true;
  timeoutCalls = 0;
  assert.strictEqual(TabNoiseVisual.start(settings(), 'test'), true);
  assert.strictEqual(pulseLinks().length, 1);
  assert.strictEqual(timeoutCalls, 1);
  TabNoiseVisual.stop(true);
  assert.deepStrictEqual(queryAll('link'), []);
  assert.strictEqual(pulseLinks().length, 0);
}

function testLazyReplace() {
  clearHead();
  reduceMotion = true;
  link('icon', '/original.png');
  assert.strictEqual(TabNoiseVisual.start(settings(), 'audible'), true);
  assert.deepStrictEqual(iconHrefs(), []);
  link('icon', '/lazy.png');
  flushObservers();
  assert.deepStrictEqual(iconHrefs(), []);
  assert.strictEqual(pulseLinks().length, 1);
  TabNoiseVisual.stop(true);
  assert.deepStrictEqual(iconHrefs(), ['icon /lazy.png']);
  assert.strictEqual(pulseLinks().length, 0);
}

function testHijackedPulseHref() {
  clearHead();
  reduceMotion = true;
  link('icon', '/original.png');
  assert.strictEqual(TabNoiseVisual.start(settings(), 'audible'), true);
  pulseLinks()[0].setAttribute('href', '/hijack.png');
  flushObservers();
  assert.ok(pulseLinks()[0].getAttribute('href').indexOf('data:image/png') === 0);
  TabNoiseVisual.stop(true);
  assert.deepStrictEqual(iconHrefs(), ['icon /hijack.png']);
  assert.strictEqual(pulseLinks().length, 0);
}

function testReducedMotionSteady() {
  clearHead();
  reduceMotion = true;
  timeoutCalls = 0;
  link('icon', '/steady.ico');
  assert.strictEqual(TabNoiseVisual.start(settings({ titleMarker: true, color: '#1D6FEA' }), 'audible'), true);
  assert.strictEqual(timeoutCalls, 1);
  assert.strictEqual(document.title, 'Fixture');
  const href = pulseLinks()[0].getAttribute('href');
  flushObservers();
  assert.strictEqual(pulseLinks()[0].getAttribute('href'), href);
  assert.strictEqual(document.title, 'Fixture');
  TabNoiseVisual.stop(true);
  assert.strictEqual(document.title, 'Fixture');
  assert.deepStrictEqual(iconHrefs(), ['icon /steady.ico']);
}

testRestoreExact();
testNoFavicon();
testLazyReplace();
testHijackedPulseHref();
testReducedMotionSteady();
console.log('favicon dom tests passed');
