# Contributing

Issues and pull requests are welcome.

- Run `node check.mjs` before opening a PR. It drives the launcher in headless Chrome (Node 22+ and
  `google-chrome` needed) and runs without a TV. CI runs it on every PR.
- If you change navigation, add a step for it to `check.mjs`.
- One change per PR. Say which TV model and firmware you tested on, if any. Only a 2021 AU7700 has been
  tested so far, so reports from other models are useful on their own.
- Keep it dependency-free: plain JS, CSS and HTML that the TV loads directly.
- Never commit signing profiles, certificates or `profiles.xml`.
