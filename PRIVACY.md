# Privacy Policy — Tab Noise Tracker

_Last updated: 25 October 2026_

Tab Noise Tracker is a browser extension that helps you find which open tab is making sound and control it (mute, focus, or close) with an optional visual alert.

## The short version

Tab Noise Tracker does not collect, store, transmit, or sell any of your data. Everything the extension does happens locally in your own browser. It makes no network requests of any kind, contains no analytics or tracking, and records no audio.

## What the extension accesses, and why

- **Tab information (titles and audible/muted state):** read locally so the extension can list which tabs are making sound and let you mute, jump to, or close them. This information is used in the moment and is never sent anywhere.
- **Local settings storage:** your Focus mode state and visual-alert preferences (brightness, colour, style, and so on) are saved in your browser's local storage so they persist between sessions. This data stays on your device.
- **Notifications (optional, off by default):** if you turn it on, the extension can show a local desktop notification when a tab starts making sound. No notification content leaves your device.
- **Visual alerts switch (on until you turn it off):** automatic favicon, toolbar, and on-page flashes run only while Visual alerts is on. A new install turns the switch on. An update that has not saved the switch yet also turns it on. While it is off, the extension does not inject the flash script and does not pulse the toolbar. The tab list, mute, jump, close, and Focus mode keep working. The optional Tab alerts notification has its own switch and is unchanged.
- **Tab-strip and optional on-page visual alert (scripting / host access):** when Visual alerts is on and a flash runs, the extension injects a small script into the noisy tab. That script swaps the tab's favicon for an icon drawn locally in memory, remembers the existing favicon link only until the alert ends so it can put that link back, and can draw an optional overlay inside the page. It does not change the page title, does not read the page body, does not fetch the site's favicon, does not save the favicon anywhere, and does not transmit anything. The same host access as before is used. No new permission is required.

## Data sharing

None. No data is collected, so there is nothing to share, sell, or transfer to any third party.

## Changes

If this policy changes, the updated version will be posted in this repository.

## Contact

Questions about this policy can be raised as an issue on the project's GitHub repository: https://github.com/IronAdamant/tab-noise-tracker
