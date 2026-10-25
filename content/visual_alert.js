/* Tab-strip favicon pulse, title marker, and optional on-page flash.
   Isolated world: it draws locally, restores the favicon and title, and does not read page content or touch audio. */
'use strict';

(function () {
  const HOST_ID = 'tab-noise-tracker-alert';
  const FAVICON_WATCH = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href', 'rel', 'type', 'sizes', 'media']
  };
  let session = 0;
  let pulseTimer = null;
  let endTimer = null;
  let observer = null;
  let host = null;
  let running = false;
  let titleActive = false;
  let originalTitle = '';
  let expectedTitle = '';
  let faviconObserver = null;
  let faviconWatchRoot = null;
  let faviconActive = false;
  let faviconTouched = false;
  let faviconBright = true;
  let faviconSettings = null;
  let savedIcons = null;
  let iconCacheKey = '';
  let iconBrightUrl = '';
  let iconDimUrl = '';
  let lastAppliedHref = '';

  function style(node, pairs) {
    Object.keys(pairs).forEach(function (key) {
      node.style.setProperty(key, pairs[key], 'important');
    });
  }

  function tell(message) {
    try {
      const pending = chrome.runtime.sendMessage(message);
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (error) {
      // The worker can be asleep. The page flash still runs on its own timer.
    }
  }

  function readableOnDark(hex) {
    const model = globalThis.TabNoiseModel;
    let color = model.normalizeSettings({ color: hex }).color;
    if (model.contrastRatio(color, '#14120E') >= 4.5) return color;
    const rgb = model.hexToRgb(color);
    for (let step = 1; step <= 8; step += 1) {
      const mix = step / 8;
      const lifted = '#' + [rgb.r, rgb.g, rgb.b].map(function (channel) {
        return Math.round(channel + (255 - channel) * mix).toString(16).padStart(2, '0');
      }).join('').toUpperCase();
      if (model.contrastRatio(lifted, '#14120E') >= 4.5) return lifted;
    }
    return '#FFFFFF';
  }

  function restoreTitle() {
    if (!titleActive) return;
    titleActive = false;
    expectedTitle = originalTitle;
    try {
      document.title = originalTitle;
    } catch (error) {
      // Some documents do not allow title changes.
    }
  }

  function applyTitle(prefix) {
    expectedTitle = prefix + originalTitle;
    titleActive = true;
    if (document.title !== expectedTitle) document.title = expectedTitle;
  }

  function watchTitle(token) {
    const rootNode = document.head || document.documentElement;
    if (!rootNode || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function () {
      if (token !== session || !titleActive) return;
      if (document.title === expectedTitle) return;
      originalTitle = TabNoiseModel.stripMarker(document.title);
      const prefix = expectedTitle.startsWith(TabNoiseModel.DIM_PREFIX)
        ? TabNoiseModel.DIM_PREFIX
        : TabNoiseModel.BRIGHT_PREFIX;
      applyTitle(prefix);
    });
    observer.observe(rootNode, { subtree: true, childList: true, characterData: true });
  }

  // Chrome will not restyle the tab strip. These icon links are the tab-level signal.
  function fillRoundRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function renderIcon(color, bright, intensity) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const rgb = TabNoiseModel.hexToRgb(color);
    const level = Math.min(100, Math.max(10, intensity));
    const span = bright
      ? Math.round(16 + (level / 100) * 10)
      : Math.round(7 + ((100 - level) / 100) * 5);
    const origin = Math.round((32 - span) / 2);
    const radius = Math.max(3, Math.round(span * 0.28));
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = bright ? 'rgba(27, 20, 4, 0.95)' : 'rgba(27, 20, 4, 0.28)';
    fillRoundRect(ctx, origin - 2, origin - 2, span + 4, span + 4, radius + 2);
    const alpha = bright ? 1 : 0.2 + ((100 - level) / 100) * 0.25;
    ctx.fillStyle = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')';
    fillRoundRect(ctx, origin, origin, span, span, radius);
    return canvas.toDataURL('image/png');
  }

  function iconUrls(settings) {
    const key = settings.color + ':' + settings.intensity;
    if (key === iconCacheKey && iconBrightUrl && iconDimUrl) {
      return { bright: iconBrightUrl, dim: iconDimUrl };
    }
    iconBrightUrl = renderIcon(settings.color, true, settings.intensity);
    iconDimUrl = renderIcon(settings.color, false, settings.intensity);
    iconCacheKey = iconBrightUrl && iconDimUrl ? key : '';
    return { bright: iconBrightUrl, dim: iconDimUrl };
  }

  function collectPageIconElements() {
    return Array.from(document.querySelectorAll('link')).filter(function (node) {
      return node.getAttribute('data-tn-favicon') !== 'pulse' &&
        TabNoiseModel.isFaviconRel(node.getAttribute('rel'));
    });
  }

  function snapshotLink(link) {
    const attrs = {};
    Array.from(link.attributes).forEach(function (attr) {
      if (attr.name === 'data-tn-favicon') return;
      attrs[attr.name] = attr.value;
    });
    return attrs;
  }

  function removePulseLinks() {
    document.querySelectorAll('link[data-tn-favicon="pulse"]').forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
  }

  function insertFaviconRecord(record) {
    const head = document.head || document.documentElement;
    if (!head || !record) return;
    const link = document.createElement('link');
    Object.keys(record).forEach(function (name) {
      if (name === 'data-tn-favicon' || typeof record[name] !== 'string') return;
      link.setAttribute(name, record[name]);
    });
    head.appendChild(link);
  }

  function insertPulseLink(dataUrl) {
    const head = document.head || document.documentElement;
    if (!head) throw new Error('No document for the favicon.');
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('type', 'image/png');
    link.setAttribute('sizes', '32x32');
    link.setAttribute('data-tn-favicon', 'pulse');
    link.setAttribute('href', dataUrl);
    head.appendChild(link);
    lastAppliedHref = link.getAttribute('href') || dataUrl;
  }

  function disconnectFaviconWatch() {
    if (faviconObserver) faviconObserver.disconnect();
    faviconObserver = null;
    faviconWatchRoot = null;
  }

  function ensureFaviconWatch() {
    const root = document.head || document.documentElement;
    if (!faviconObserver || !faviconActive || !root) return;
    if (faviconWatchRoot === root) return;
    faviconObserver.disconnect();
    faviconWatchRoot = root;
    faviconObserver.observe(root, FAVICON_WATCH);
  }

  function pauseFaviconWatch(work) {
    if (faviconObserver) faviconObserver.disconnect();
    faviconWatchRoot = null;
    try {
      work();
    } finally {
      if (faviconObserver && faviconActive) ensureFaviconWatch();
    }
  }

  function rememberForeignPulseHref() {
    const pulse = document.querySelector('link[data-tn-favicon="pulse"]');
    if (!pulse) return;
    const href = pulse.getAttribute('href');
    if (!href || href === lastAppliedHref) return;
    savedIcons = TabNoiseModel.preferLiveFavicons(savedIcons, [{ rel: 'icon', href: href }]);
  }

  function absorbLiveIcons() {
    const live = collectPageIconElements();
    if (!live.length) return;
    savedIcons = TabNoiseModel.preferLiveFavicons(savedIcons, live.map(snapshotLink));
    live.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
  }

  function faviconNeedsReassert() {
    if (collectPageIconElements().length) return true;
    const pulse = document.querySelector('link[data-tn-favicon="pulse"]');
    if (!pulse) return true;
    return pulse.getAttribute('href') !== lastAppliedHref;
  }

  function restoreFavicon() {
    if (!faviconTouched || !globalThis.TabNoiseModel) return;
    try {
      const live = collectPageIconElements().map(snapshotLink);
      const plan = TabNoiseModel.planFaviconRestore(savedIcons, live);
      removePulseLinks();
      if (!plan.leaveLive) plan.recreate.forEach(insertFaviconRecord);
    } catch (error) {
      try { removePulseLinks(); } catch (ignore) {}
    }
    faviconTouched = false;
    faviconSettings = null;
    savedIcons = null;
    iconCacheKey = '';
    iconBrightUrl = '';
    iconDimUrl = '';
    lastAppliedHref = '';
  }

  function paintFavicon(bright) {
    if (!faviconActive || !faviconSettings) return;
    faviconBright = !!bright;
    let dataUrl = '';
    try {
      const urls = iconUrls(faviconSettings);
      dataUrl = bright ? urls.bright : urls.dim;
    } catch (error) {
      return;
    }
    if (!dataUrl) return;
    const pulse = document.querySelector('link[data-tn-favicon="pulse"]');
    if (pulse && pulse.getAttribute('href') === lastAppliedHref && lastAppliedHref === dataUrl &&
        !collectPageIconElements().length) {
      return;
    }
    try {
      pauseFaviconWatch(function () {
        rememberForeignPulseHref();
        absorbLiveIcons();
        removePulseLinks();
        insertPulseLink(dataUrl);
      });
    } catch (error) {
      faviconActive = false;
      disconnectFaviconWatch();
      restoreFavicon();
    }
  }

  function watchFavicon(token) {
    const root = document.head || document.documentElement;
    if (!root || typeof MutationObserver !== 'function') return;
    faviconObserver = new MutationObserver(function () {
      if (token !== session || !faviconActive) return;
      try {
        if (!faviconNeedsReassert()) return;
        paintFavicon(faviconBright);
      } catch (error) {
        // Title and overlay keep their own timers. stop() still restores the icon.
      }
    });
    faviconWatchRoot = null;
    ensureFaviconWatch();
  }

  function beginFavicon(settings, token) {
    faviconSettings = settings;
    savedIcons = collectPageIconElements().map(snapshotLink);
    faviconTouched = true;
    faviconActive = true;
    faviconBright = true;
    iconCacheKey = '';
    iconBrightUrl = '';
    iconDimUrl = '';
    lastAppliedHref = '';
    watchFavicon(token);
  }

  function phraseFor(reason) {
    if (reason === 'focus-mute') return 'Focus mode muted this tab';
    if (reason === 'test') return 'Test flash';
    return 'This tab is making sound';
  }

  function borderWidth(intensity) {
    return Math.round(6 + (intensity / 100) * 22);
  }

  function solidAlpha(intensity, bright) {
    const peak = 0.16 + (intensity / 100) * 0.58;
    return bright ? peak : peak * 0.12;
  }

  function buildOverlay(settings, reason) {
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
    host = document.createElement('div');
    host.id = HOST_ID;
    style(host, {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      'z-index': '2147483647',
      'pointer-events': 'none',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      'max-width': 'none',
      'max-height': 'none',
      transform: 'none'
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const wash = document.createElement('div');
    style(wash, {
      position: 'fixed',
      inset: '0',
      'pointer-events': 'none',
      background: 'transparent'
    });
    const chip = document.createElement('div');
    chip.setAttribute('role', 'status');
    chip.setAttribute('aria-live', 'polite');
    style(chip, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      'pointer-events': 'auto',
      display: 'flex',
      'align-items': 'center',
      gap: '12px',
      'max-width': '92vw',
      'box-sizing': 'border-box',
      padding: settings.style === 'text' ? '16px 18px' : '10px 12px',
      background: '#14120E',
      color: '#FFFAF0',
      'border-radius': '12px',
      'border-left': '8px solid ' + settings.color,
      'box-shadow': '0 8px 24px rgba(0, 0, 0, 0.35)',
      'font-family': 'system-ui, sans-serif',
      'font-size': settings.style === 'text' ? Math.round(20 + settings.intensity / 8) + 'px' : '18px',
      'font-weight': '700',
      'line-height': '1.3'
    });
    const phrase = document.createElement('span');
    phrase.textContent = phraseFor(reason);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Dismiss alert';
    style(button, {
      'pointer-events': 'auto',
      cursor: 'pointer',
      'min-height': '44px',
      padding: '8px 14px',
      'border-radius': '8px',
      border: '2px solid #FFFAF0',
      background: '#FFFAF0',
      color: '#14120E',
      'font': 'inherit',
      'font-size': '16px',
      'font-weight': '700'
    });
    button.addEventListener('click', function () { stop(false); });
    button.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        stop(false);
      }
    });
    chip.append(phrase, button);
    shadow.append(wash, chip);
    document.documentElement.appendChild(host);

    const chosen = readableOnDark(settings.color);
    const other = chosen === '#FFFFFF' ? '#FFB000' : '#FFFFFF';
    return {
      paint: function (bright) {
        if (settings.style === 'solid') {
          const rgb = TabNoiseModel.hexToRgb(settings.color);
          const alpha = solidAlpha(settings.intensity, bright);
          style(wash, { background: 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + alpha + ')' });
        } else if (settings.style === 'border') {
          const width = bright ? borderWidth(settings.intensity) : Math.max(4, Math.round(borderWidth(settings.intensity) * 0.45));
          style(wash, {
            background: 'transparent',
            'box-shadow': 'inset 0 0 0 ' + width + 'px ' + settings.color + ', inset 0 0 0 ' + (width + 3) + 'px #1B1404'
          });
        } else {
          style(wash, { background: 'transparent', 'box-shadow': 'none' });
          style(phrase, { color: bright ? chosen : other });
        }
      }
    };
  }

  function clearTimers() {
    if (pulseTimer) clearTimeout(pulseTimer);
    if (endTimer) clearTimeout(endTimer);
    pulseTimer = null;
    endTimer = null;
  }

  function stop(silent) {
    session += 1;
    clearTimers();
    faviconActive = false;
    if (observer) observer.disconnect();
    observer = null;
    disconnectFaviconWatch();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    restoreFavicon();
    restoreTitle();
    if (!silent && running) tell({ type: 'tn-flash-ended' });
    running = false;
  }

  function start(config, reason) {
    if (!globalThis.TabNoiseModel || !document.documentElement) return false;
    const settings = TabNoiseModel.normalizeSettings(config);
    if (!TabNoiseModel.alertSurfaces(settings).page) return false;
    stop(true);
    const token = session;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flashReason = reason || 'audible';
    let overlay = null;
    try {
      originalTitle = TabNoiseModel.stripMarker(document.title || '');
      if (settings.titleMarker) {
        applyTitle(TabNoiseModel.BRIGHT_PREFIX);
        watchTitle(token);
      }
      if (settings.faviconFlash) beginFavicon(settings, token);
      if (settings.overlay) overlay = buildOverlay(settings, flashReason);
    } catch (error) {
      stop(true);
      return false;
    }

    const paint = function (bright) {
      if (token !== session) return;
      if (overlay) overlay.paint(bright);
      if (settings.titleMarker) {
        applyTitle(bright ? TabNoiseModel.BRIGHT_PREFIX : TabNoiseModel.DIM_PREFIX);
      }
      if (settings.faviconFlash) paintFavicon(bright);
    };
    const hold = function () {
      if (token !== session) return;
      if (overlay) overlay.paint(true);
      if (settings.titleMarker) applyTitle(TabNoiseModel.BRIGHT_PREFIX);
      if (settings.faviconFlash) paintFavicon(true);
      if (settings.toolbar) tell({ type: 'tn-toolbar-hold' });
    };

    running = true;
    const finishAfter = function (delay) {
      endTimer = setTimeout(function () {
        if (token === session) stop(false);
      }, delay);
    };
    if (reduced) {
      hold();
      finishAfter(TabNoiseModel.HOLD_MS);
      return true;
    }

    const half = Math.max(250, Math.round(settings.intervalMs / 2));
    if (settings.continuous) {
      let bright = true;
      const tick = function () {
        if (token !== session) return;
        paint(bright);
        if (settings.toolbar) tell({ type: 'tn-toolbar-phase', bright: bright });
        bright = !bright;
        pulseTimer = setTimeout(tick, half);
      };
      tick();
      finishAfter(TabNoiseModel.CONTINUOUS_MS);
      return true;
    }

    const steps = settings.pulseCount * 2;
    let step = 0;
    const tick = function () {
      if (token !== session) return;
      if (step >= steps) {
        hold();
        finishAfter(TabNoiseModel.HOLD_MS);
        return;
      }
      const bright = step % 2 === 0;
      paint(bright);
      if (settings.toolbar) tell({ type: 'tn-toolbar-phase', bright: bright });
      step += 1;
      pulseTimer = setTimeout(tick, half);
    };
    tick();
    return true;
  }

  globalThis.TabNoiseVisual = { start: start, stop: stop };

  if (!globalThis.__tabNoiseVisualLoaded) {
    globalThis.__tabNoiseVisualLoaded = true;
    const inExtensionPage = location.protocol === 'chrome-extension:';
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message) return;
      if (inExtensionPage && message.target === 'extension-page' && message.type === 'tn-flash-stop') {
        globalThis.TabNoiseVisual.stop(true);
        sendResponse({ ok: true });
        return;
      }
      if (message.target !== 'content') return;
      if (message.type === 'tn-flash-start') {
        sendResponse({ ok: !!globalThis.TabNoiseVisual.start(message.config, message.reason) });
        return;
      }
      if (message.type === 'tn-flash-stop') {
        globalThis.TabNoiseVisual.stop(true);
        sendResponse({ ok: true });
      }
    });
  }
})();
