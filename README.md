# tv-shinnagans

**A custom TV home screen, starting with Samsung Tizen.** Tizen is the only platform for now; Android TV /
Google TV and others are planned. Contributions are welcome.

A clean home screen for a Samsung Tizen TV (built on a 2021 AU7700), after
[CleanYourTV](https://github.com/Gathin23/cleanyourtv): a thin clock and greeting, a top shelf that names the
focused app over a glow in its colour, a dock, an app grid, one glass highlight, an Inputs panel and a
clock screensaver.

## Use

| | |
|---|---|
| Arrows / OK | Move / open |
| Hold OK on an app | Move, add to or remove from the Dock, hide |
| Back | Out of a menu or a move, back to the Dock, or out of an HDMI picture |
| Hidden apps | At the bottom of the grid; OK puts one back |
| My Sports | Channels and matches saved in Couch TV's Sports screen. OK plays one in Couch TV. A banner shows from 10 minutes before a saved match until 15 minutes after it starts |

Change the grid, background, glow, clock screensaver and sleep timer from the launcher's Settings page. The sleep timer lives in the boot service (`/sleep`), so it keeps running in any app. When time is up it puts the TV in standby with the remote's Power key. The first time it's set, the TV may ask to Allow "Home launcher"; the token is saved in the app's data folder. `launcher/config.js` still sets first-run defaults and options such as dock size, input names, and your name.

## Install

It isn't in Samsung's app store: you install it with the TV's Developer Mode and your own free Samsung
certificate. One-time setup:

1. On a computer on the same network, install [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)
   (the CLI is enough) and, in its Package Manager, **TV Extensions** and **Samsung Certificate Extension**.
2. On the TV, open **Apps**, type `12345` on the remote, switch **Developer mode** On, set **Host PC IP** to this
   computer's IP, and restart the TV.
3. Connect: `~/tizen-studio/tools/sdb connect <TV IP>` (the TV's IP is under Settings → General → Network →
   Network Status).
4. In Tizen Studio's **Certificate Manager** (on Linux under Wayland, start it with `GDK_BACKEND=x11`), add a
   **Samsung → TV** profile: a new author certificate, your Samsung account, and a distributor certificate with
   privilege **Public**. With `sdb` connected the TV's DUID is filled in; check it is listed. Name it `couch`,
   or pass `PROFILE=<name>` below.

Then, and again after any change:

```sh
TV=<TV IP> ./deploy.sh              # package, sign, install and open it on the TV
node check.mjs [screenshot-dir]     # headless-Chrome check of navigation, runs without the TV
```

If Developer Mode is turned off or the TV is reset, the app can disappear: run `./deploy.sh` again.

## What Tizen will not do

- **The Home button always opens Samsung Home.** No app can take it; pin this app first on Samsung's
  home row. What the launcher does instead:
  - `launcher/service.js`, a background service, opens Home at power-on and on every wake from standby
    (about 6 s after the screen comes on, so Smart Hub finishes first). Tune its timings at the top of the file.
  - The TV closes it when another app opens, which frees ~70 MB on this 1 GB set. It saves where you were
    first, so it reopens on the same app or TV input in about half a second.
- **No debloat.** There is no way to disable Samsung's own apps. What you can turn off, in
  Settings → Support → Terms & Privacy (names vary by firmware): *Interest-Based Advertisement*,
  *Viewing Information Services*, and *Voice Recognition Services* if you don't use voice.
- For ads in Samsung's own UI, an ad-blocking DNS on the router (Pi-hole, AdGuard Home or NextDNS) is the
  rest of the cleanup.

## Platforms

| Platform | Status |
|---|---|
| Samsung Tizen (tested on 2021 AU7700) | Works |
| Android TV / Google TV | Planned |

Want another platform? Open an issue, or a PR that adds it in its own folder next to `launcher/`.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Tested only on a 2021 AU7700,
so reports from other Samsung models help.

## License

[MIT](LICENSE). The Outfit font is under the [SIL Open Font License](launcher/fonts/OFL.txt).
