# tv-shinnagans

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

TV: Developer Mode on (Apps, type `12345`), with this computer's IP as Host PC IP.

```sh
./deploy.sh                      # TV=192.168.1.33 PROFILE=couch by default
node check.mjs [screenshot-dir]  # headless-Chrome check of navigation, runs without the TV
```

The signing profile's distributor certificate has to list the TV's DUID
(`sdb -s <tv>:26101 shell 0 getduid`). If install fails with a certificate error, add it in Tizen Studio's
Certificate Manager.

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
- Developer apps can disappear if Developer Mode is turned off or the TV is reset; run `./deploy.sh` again.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Tested only on a 2021 AU7700,
so reports from other Samsung models help.

## License

[MIT](LICENSE). The Outfit font is under the [SIL Open Font License](launcher/fonts/OFL.txt).
