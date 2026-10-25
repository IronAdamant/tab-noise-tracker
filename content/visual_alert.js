/* On-page flash and title marker. Isolated world: it does not read the page or touch audio. */
'use strict';

(function () {
  const HOST_ID = 'tab-noise-tracker-alert';
  let session = 0;
  let pulseTimer = null;
  let endTimer = null;
  let observer = null;
  let host = null;
  let running = false;
  let titleActive = false;
  let originalTitle = '';
  let expectedTitle = '';

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
    if (observer) observer.disconnect();
    observer = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    restoreTitle();
    if (!silent && running) tell({ type: 'tn-flash-ended' });
    running = false;
  }

  function start(config, reason) {
    if (!globalThis.TabNoiseModel || !document.documentElement) return false;
    const settings = TabNoiseModel.normalizeSettings(config);
    if (!settings.overlay && !settings.titleMarker) return false;
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
    };
    const hold = function () {
      if (token !== session) return;
      if (overlay) overlay.paint(true);
      if (settings.titleMarker) applyTitle(TabNoiseModel.BRIGHT_PREFIX);
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
