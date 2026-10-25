# Tab Noise Tracker

A Chrome extension that shows which **tab** is making sound, lets you mute or close it, and flashes a visual alert you can see without hearing anything.

It is the browser-tab sibling of [Windows Sound Tracker](https://github.com/IronAdamant/windows_sound_tracker). The Windows app can tell programs apart, but a browser's tabs share one audio process, so it cannot say which tab inside Chrome is the source. This extension fills that gap. Chrome already knows the tab: the `audible` flag marks a tab that is producing sound, and `mutedInfo` marks one that is muted.

![Tab Noise Tracker icon](icons/icon128.png)

The extension is local. It is plain HTML, CSS, and JavaScript. There is no build step, no package install, and no network request.

## What it does

### 1. Noise detection

Open the toolbar popup to see every tab that is currently producing sound.

- Each row shows a local letter mark, the tab title, and which window it belongs to (for example `Window 2 · focused`).
- A tab that is producing sound but muted stays in the list, labelled as muted.
- When nothing is audible, the popup says so.
- The toolbar badge counts audible tabs, including ones that are muted but still producing sound. The badge turns amber when at least one of them is actually playing. Hover the icon for the same counts.
- The moving bars next to "Playing" only mean the tab is playing. They are not a loudness meter. Chrome does not give extensions a per-tab volume, and this extension does not record audio to invent one.

The list stays current while the popup is open. The background worker watches `chrome.tabs.onUpdated` for `audible` and `mutedInfo` changes, so the badge updates even when the popup is closed.

### 2. Quick controls

Each row has large buttons:

- **Mute** or **Unmute** that tab.
- **Jump to tab**, which selects it and focuses its window.
- **Close tab**.
- **Stop flash**, when that tab is currently flashing.

You can reach every control from the keyboard. Buttons have accessible names that include the tab title.

### 3. Focus mode

Focus mode keeps a single listening tab unmuted and mutes every other tab.

- When you turn it on, the listening tab is the active tab in the window you are using.
- Switching tabs (`chrome.tabs.onActivated`, or focusing another window) moves the listening tab with you. The previous tab is muted. If that previous tab was producing sound, it flashes so you can see which one was silenced.
- If a different tab starts producing sound, sound follows that tab: it becomes the listening tab, the others are muted, and it flashes.
- Unmuting a tab from the popup, or with Chrome's own mute control, makes that tab the listening tab.
- Muting the listening tab from the popup keeps it muted until you switch tabs or unmute it. Focus mode will not immediately turn it back on.
- **Turning Focus mode off restores the mute state each tab had when Focus mode was turned on**, including tabs that were opened while it was on. Changes you made only while it was on are not kept, except that restored snapshot. This is deliberate, so the result is predictable.
- The on/off state is stored in `chrome.storage.local` and survives closing the popup and restarting the browser. After a restart, Focus mode reapplies the same rule. It does not replay old flashes.
- Suggested shortcut: **Alt+Shift+F** (Mac: **Control+Shift+F**). If that chord is already taken, set another at `chrome://extensions/shortcuts`. The popup shows the shortcut Chrome actually bound.

### Visual alerts

Visual flashing is a primary signal, not a decoration. When a tab becomes audible, the extension flashes so you can see the source without hearing it. The same flash runs when Focus mode mutes a tab that was producing sound, if that option is on.

Three surfaces, each with its own switch:

1. **On-page flash.** A script draws a border, a colour wash, or a banner over the noisy tab. This is the strongest signal. A **Dismiss alert** button sits on the banner.
2. **Tab title marker.** The tab's title alternates between two speaker symbols so the tab strip itself changes. The original title is restored when the alert ends.
3. **Toolbar flash.** The extension icon swaps to the amber alert icon and the badge colour pulses.

The popup says which rows are flashing and offers **Jump to tab** and **Stop flash**.

Open **Visual alert settings** for:

- Brightness, from subtle to strong.
- Colour, as presets or a colour picker.
- Style: border only, solid flash, or text that changes colour.
- Time between pulses, and how many pulses run.
- Continuous flashing until you dismiss it. A safety stop ends that mode after 6 hours.
- Independent switches for the three surfaces, for "flash when Focus mode mutes a tab", and for silent OS notifications.
- **Test flash**, which runs on the settings tab so you can judge brightness, colour, and speed, and also exercises the toolbar icon.

After a finite number of pulses, a steady highlight remains for about 12 seconds. Dismiss it from the banner, the settings page, or the popup. If the sound stops, an alert that was only saying "this tab started" clears as well. A "Focus mode muted this tab" alert stays for its normal time so the silenced tab is still findable.

**Safety.** The fastest setting is two pulses per second, which stays under the common guidance of three flashes per second. The default is slower: one pulse every 1.5 seconds, border style, 70% brightness. The page warns when you choose a faster speed, a very bright full-window flash, continuous flashing, or a saturated red. If the operating system asks for reduced motion, the alert is a steady highlight for about 12 seconds instead of a pulse. Reduced motion wins over the continuous option. Reduced motion is checked on the page itself, and again whenever you open the popup or the settings.

The on-page script cannot run on browser pages such as `chrome://` settings, the Chrome Web Store, or other extensions. Those tabs still show up in the popup, and the toolbar still changes. A discarded (asleep) tab is not woken just to draw a flash; open it and the flash is retried if it is still active.

### Tab alerts

This is the small sibling of Windows Sound Tracker's Window Alerts: one optional, silent operating-system notification when a tab starts making sound after being quiet. There are no per-app trigger levels. The switch is in the popup and in settings. It is off until you turn it on.

A short cooldown (5 seconds) stops one tab from notifying and flashing again if Chrome's audible flag flickers. A Focus-mode mute flash, and the Test flash button, do not start that cooldown, so a real sound start still alerts. The notification has no sound. Choosing it focuses that tab. If you are already looking at the tab and the on-page flash or title marker is on, the extra notification is skipped.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the folder that contains `manifest.json` (the repository root, not a subfolder).
6. Pin **Tab Noise Tracker** if you want the badge in the toolbar.
7. Optional: on the extension's details page, turn on **Allow in Incognito** if private windows should be included. The extension uses one shared copy (`"incognito": "spanning"`), so Focus mode and settings are the same ones. Private windows are labelled in the list.
8. Optional: open `chrome://extensions/shortcuts` and confirm **Toggle Focus mode**.

Chrome 114 or newer is required. There is nothing to compile and nothing to `npm install`.

To try a tone without leaving the machine, open `tests/fixture/sound.html` from a local web server (a `file://` page cannot receive the on-page flash). The fixture plays a generated tone. It does not download audio.

## Permissions

| Permission | Why it is requested |
| --- | --- |
| `tabs` | Read titles, window ids, the `audible` flag, and mute state. Mute, unmute, focus, and close tabs. Without `tabs`, Chrome hides titles and audible state from extensions. |
| `storage` | Save Focus mode, the mute snapshot taken when Focus mode starts, and visual-alert settings in `chrome.storage.local`. Short-lived flash state uses `chrome.storage.session` and is discarded when the browser closes. |
| `notifications` | Optional silent visual notification when a tab starts making sound. No notification is shown unless you turn Tab alerts on. |
| `scripting` | Inject the visual-alert script into a tab at the moment it needs to flash. The script is not loaded on every page at startup. |
| Host access to `http://*/*` and `https://*/*` | The flash has to be drawn inside the website that is making sound, which can be any site. The script only draws the overlay and changes that tab's title. It does not read the page, does not touch the audio, and does not open a connection. |

No other host permissions, no content script registered for every page, and no remote code.

Chrome's install prompt for host access says the extension can read and change site data. That is the browser's wording for "may inject a script". The script in this repository does not do that.

## Privacy

Only metadata is used: which tab is producing sound, its title and window, and when that started or stopped. No audio is recorded, measured, or sent anywhere. Nothing leaves the browser. There is no account, no analytics, and no remote script or font.

Settings and the Focus snapshot stay in `chrome.storage.local` on this device. Letter marks in the popup are drawn locally. Remote favicons are not loaded, so showing the list cannot trigger a network request.

The injected script runs in an isolated world. It creates its own overlay, prefixes `document.title`, and restores the title when the alert ends. It does not read the page body.

## Check the logic locally

```bash
node tests/logic_test.js
python3 tools/draw_icons.py   # redraws the original icons; not required to run the extension
```

Those checks cover settings limits, contrast of the badge and colour presets, Focus mute/restore plans, and how rows are sorted and labelled. They do not start Chrome.

## Trying it in Chrome

1. Load the extension unpacked.
2. Open two windows and play audio in one tab. The badge count should rise, and the popup should name the tab and the window.
3. Mute, unmute, jump, and close from the popup. Mute from Chrome's own tab control too, with Focus mode on, and confirm sound follows an unmute.
4. Turn Focus mode on. Only the active tab should stay unmuted. Switch tabs and confirm the previous noisy tab is muted and flashes. Start audio in a background tab and confirm sound moves there. Turn Focus mode off and confirm the earlier mute states return. Restart Chrome and confirm Focus mode is still on.
5. Open Visual alert settings. Use Test flash for border, solid, and text styles. Move brightness and speed and confirm the warning appears for fast, very bright, continuous, or saturated-red choices. Turn each surface off and on. Set the OS to reduce motion and confirm the test is a steady highlight.
6. Turn on Tab alerts, start audio in a background tab, and confirm a silent notification. Click it and confirm the tab is focused.
7. Open `chrome://extensions` (or any `chrome://` page) and confirm the popup explains that the page itself cannot flash.
8. With no audio playing, confirm the empty state and a cleared badge.

## Limits

- Loudness is not available. The bars are an activity mark, not a meter.
- `chrome://` pages, the Chrome Web Store, PDF viewer pages, and other extensions cannot host the overlay or the title marker.
- A discarded tab is not reloaded just to draw a flash.
- The toolbar animation is driven by the page when the overlay runs. If Chrome stops the extension worker, a toolbar-only pulse can pause; the badge then holds the alert colour until the alert ends. The on-page flash keeps its own timer inside the tab.
- Focus mode is one listening tab for the whole browser, not one per window.
- Turning Focus mode off restores the snapshot from when it was turned on.
- Incognito tabs are visible only after you allow the extension in Incognito.
- The audible flag can lag real audio by a couple of seconds. That is Chrome's definition of `audible`.
- There is no GitHub Actions workflow. The logic checks above are local.

## Layout

```
manifest.json
background.js                 service worker
background/storage_gateway.js
background/focus_controller.js
background/signal_controller.js
popup.html / popup.js / popup.css
options.html / options.js / options.css
content/visual_alert.js       injected only when a tab should flash
shared/tracker_model.js       settings, Focus plans, row text
shared/extension.css
icons/                        original 16/32/48/128 icons, plus alert variants
tools/draw_icons.py
tests/logic_test.js
tests/fixture/sound.html
```

## License

MIT. Copyright (c) 2026 Iron Adamant. See [LICENSE](LICENSE).
