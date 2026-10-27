# Privacy Policy — Tab Noise Tracker

_Last updated: 28 October 2026_

Tab Noise Tracker is a browser extension, available on the [Chrome Web Store](https://chromewebstore.google.com/detail/tab-noise-tracker/kobbcpmekekmdpjichchfnicgbbbphmg), that helps you find which open tab is making sound and control it (mute, focus, or close) with an optional visual alert.

## The short version

Tab Noise Tracker does not collect, store, transmit, or sell any of your data. Everything the extension does happens locally in your own browser. It makes no network requests of any kind, contains no analytics or tracking, and records no audio.

## What the extension accesses, and why

- **Tab information (titles, window, audible/muted state, and whether the address is an ordinary web page):** read locally so the extension can list which tabs are making sound, let you mute, jump to, or close them, and tell whether a page can show a flash (browser pages such as `chrome://` cannot). This information is used in the moment and is never stored or sent anywhere.
- **Local settings storage:** your Focus mode state and visual-alert preferences (brightness, colour, style, and so on) are saved in your browser's local storage so they persist between sessions. This data stays on your device.
- **Notifications (optional, off by default):** if you turn it on, the extension can show a local desktop notification when a tab starts making sound. No notification content leaves your device.
- **Visual alerts switch (on until you turn it off):** automatic favicon, toolbar, and on-page flashes run only while Visual alerts is on. A new install turns the switch on. An update that has not saved the switch yet also turns it on. While it is off, the extension does not inject the flash script and does not pulse the toolbar. The tab list, mute, jump, close, and Focus mode keep working. The optional Tab alerts notification has its own switch and is unchanged.
- **Tab-strip and optional on-page visual alert (scripting / host access):** when Visual alerts is on and a flash runs, the extension injects a small script into the noisy tab. That script swaps the tab's favicon for an icon drawn locally in memory, remembers the existing favicon link only until the alert ends so it can put that link back, and can draw an optional overlay inside the page. It does not change the page title, does not read the page body, does not fetch the site's favicon, does not save the favicon anywhere, and does not transmit anything. The same host access as before is used. No new permission is required.

## Earlier versions

Version 1.0.0, the first Chrome Web Store build, also had an optional tab-title marker, on by default, that added a symbol to the start of the page title while a flash ran and removed it afterwards, and its on-page overlay was on by default. From version 1.0.2 the title is never changed and the overlay is off by default. In every version the extension collects and transmits nothing.

## Data sharing

None. No data is collected, so there is nothing to share, sell, or transfer to any third party.

## Changes

If this policy changes, the updated version will be posted in this repository.

## Contact

Questions about this policy can be raised as an issue on the project's GitHub repository: https://github.com/IronAdamant/tab-noise-tracker
