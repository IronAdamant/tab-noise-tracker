/* Options page. Settings are normalized and stored with chrome.storage.local. */
'use strict';

(function () {
  const fields = {
    visualAlerts: document.getElementById('visual-alerts'),
    faviconFlash: document.getElementById('favicon-flash'),
    toolbar: document.getElementById('toolbar'),
    overlay: document.getElementById('overlay'),
    focusMute: document.getElementById('focus-mute'),
    tabAlerts: document.getElementById('tab-alerts'),
    continuous: document.getElementById('continuous'),
    colour: document.getElementById('colour'),
    intensity: document.getElementById('intensity'),
    interval: document.getElementById('interval'),
    pulseCount: document.getElementById('pulse-count')
  };
  const outputs = {
    intensity: document.getElementById('intensity-value'),
    interval: document.getElementById('interval-value'),
    pulseCount: document.getElementById('pulse-value')
  };
  const swatches = document.getElementById('swatches');
  const warning = document.getElementById('warning');
  const motion = document.getElementById('motion');
  const testStatus = document.getElementById('test-status');
  const saveStatus = document.getElementById('save-status');
  let current = TabNoiseModel.normalizeSettings(null);
  let saveTimer = null;
  let writing = false;

  function seconds(ms) {
    const value = (ms / 1000).toFixed(1).replace(/\.0$/, '');
    return value + ' s';
  }

  function selectedStyle() {
    const picked = document.querySelector('input[name="style"]:checked');
    return picked ? picked.value : 'border';
  }

  function readForm() {
    return TabNoiseModel.normalizeSettings({
      visualAlerts: fields.visualAlerts.checked,
      faviconFlash: fields.faviconFlash.checked,
      toolbar: fields.toolbar.checked,
      overlay: fields.overlay.checked,
      flashOnFocusMute: fields.focusMute.checked,
      tabAlerts: fields.tabAlerts.checked,
      continuous: fields.continuous.checked,
      color: fields.colour.value,
      intensity: Number(fields.intensity.value),
      intervalMs: Number(fields.interval.value),
      pulseCount: Number(fields.pulseCount.value),
      style: selectedStyle()
    });
  }

  function paintSwatches(color) {
    swatches.querySelectorAll('.swatch').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.color === color ? 'true' : 'false');
    });
  }

  function applyAlertAvailability(settings) {
    const on = !!settings.visualAlerts;
    document.getElementById('surfaces').disabled = !on;
    fields.focusMute.disabled = !on;
    const note = document.getElementById('master-note');
    const text = on
      ? ''
      : 'Favicon, toolbar, on-page, and Focus-mute flash stay saved, but no automatic flash runs while visual alerts are off. Test flash still previews them. Tab alerts are separate.';
    if (note.textContent !== text) note.textContent = text;
  }

  function fillForm(settings) {
    current = settings;
    fields.visualAlerts.checked = settings.visualAlerts;
    fields.faviconFlash.checked = settings.faviconFlash;
    fields.toolbar.checked = settings.toolbar;
    fields.overlay.checked = settings.overlay;
    fields.focusMute.checked = settings.flashOnFocusMute;
    fields.tabAlerts.checked = settings.tabAlerts;
    fields.continuous.checked = settings.continuous;
    fields.colour.value = settings.color;
    fields.intensity.value = String(settings.intensity);
    fields.interval.value = String(settings.intervalMs);
    fields.pulseCount.value = String(settings.pulseCount);
    document.querySelectorAll('input[name="style"]').forEach(function (input) {
      input.checked = input.value === settings.style;
    });
    outputs.intensity.textContent = settings.intensity + '%';
    outputs.interval.textContent = seconds(settings.intervalMs);
    outputs.pulseCount.textContent = String(settings.pulseCount);
    fields.pulseCount.disabled = settings.continuous;
    paintSwatches(settings.color);
    const text = TabNoiseModel.warningText(settings);
    if (warning.textContent !== text) warning.textContent = text;
    applyAlertAvailability(settings);
  }

  function scheduleSave() {
    current = readForm();
    outputs.intensity.textContent = current.intensity + '%';
    outputs.interval.textContent = seconds(current.intervalMs);
    outputs.pulseCount.textContent = String(current.pulseCount);
    fields.pulseCount.disabled = current.continuous;
    paintSwatches(current.color);
    const text = TabNoiseModel.warningText(current);
    if (warning.textContent !== text) warning.textContent = text;
    applyAlertAvailability(current);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(); }, 150);
  }

  async function saveNow() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    current = readForm();
    writing = true;
    try {
      await chrome.storage.local.set({
        settings: current,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      });
      if (saveStatus.textContent !== 'Saved on this device.') {
        saveStatus.textContent = 'Saved on this device.';
      }
    } catch (error) {
      saveStatus.textContent = 'Could not save settings.';
    } finally {
      writing = false;
    }
    return current;
  }

  function buildSwatches() {
    TabNoiseModel.COLOR_PRESETS.forEach(function (preset) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = preset.value;
      button.textContent = preset.label;
      button.style.background = preset.value;
      button.style.color = TabNoiseModel.inkFor(preset.value);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        fields.colour.value = preset.value;
        scheduleSave();
      });
      swatches.append(button);
    });
  }

  document.querySelectorAll('input').forEach(function (input) {
    input.addEventListener('input', scheduleSave);
    input.addEventListener('change', scheduleSave);
  });

  function previewNote(saved) {
    return saved.visualAlerts ? '' : ' This was a preview. Automatic alerts stay off.';
  }

  function startedMessage(settings) {
    const parts = [];
    if (settings.faviconFlash) parts.push('the tab icon');
    if (settings.overlay) parts.push('the page');
    if (settings.toolbar) parts.push('the toolbar icon');
    if (!parts.length) return 'Test flash started.';
    if (parts.length === 1) return 'Test flash started. Look at ' + parts[0] + '.';
    const last = parts[parts.length - 1];
    return 'Test flash started. Look at ' + parts.slice(0, -1).join(', ') + ' and ' + last + '.';
  }

  document.getElementById('test-flash').addEventListener('click', async function () {
    const saved = await saveNow();
    const settings = TabNoiseModel.mergeSettings(saved, { visualAlerts: true });
    testStatus.textContent = '';
    const surfaces = TabNoiseModel.alertSurfaces(settings);
    if (!surfaces.any) {
      testStatus.textContent = 'Turn on at least one alert surface first.';
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      testStatus.textContent = 'This settings tab could not be found.';
      return;
    }
    const wantsPage = surfaces.page;
    let response = await chrome.runtime.sendMessage({
      type: 'tn-test-flash',
      tabId: tab.id,
      pageDriven: wantsPage,
      settings: settings
    });
    if (!response || response.ok === false) {
      testStatus.textContent = response && response.error ? response.error : 'Could not start the test flash.';
      return;
    }
    if (wantsPage) {
      const drew = TabNoiseVisual.start(settings, 'test');
      if (!drew && settings.toolbar) {
        await chrome.runtime.sendMessage({
          type: 'tn-test-flash',
          tabId: tab.id,
          pageDriven: false,
          settings: settings
        });
        testStatus.textContent = 'The tab flash could not start. The toolbar will still change.' + previewNote(saved);
        return;
      }
      if (!drew) {
        await chrome.runtime.sendMessage({ type: 'tn-dismiss-current' });
        testStatus.textContent = 'This page could not show the flash.';
        return;
      }
    }
    testStatus.textContent = startedMessage(settings) + previewNote(saved);
  });

  document.getElementById('stop-flash').addEventListener('click', async function () {
    const response = await chrome.runtime.sendMessage({ type: 'tn-dismiss-current' });
    testStatus.textContent = response && response.ok === false
      ? response.error
      : 'Flash stopped.';
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.settings || writing) return;
    const next = TabNoiseModel.normalizeSettings(changes.settings.newValue);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    fillForm(next);
  });

  buildSwatches();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  motion.textContent = reduced
    ? 'Your system is set to reduce motion, so alerts stay steady instead of pulsing.'
    : 'Your system allows motion, so alerts pulse at the speed you choose.';

  chrome.storage.local.get('settings').then(function (data) {
    fillForm(TabNoiseModel.normalizeSettings(data.settings));
  }).catch(function () {
    fillForm(TabNoiseModel.normalizeSettings(null));
    saveStatus.textContent = 'Saved settings could not be read. Showing defaults.';
  });
})();
