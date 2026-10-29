# Rea Office

An Electron desktop suite: Rea Docs (word processor), Rea Sheets (spreadsheet) and Rea Slides (presentations), each with Claude built in through the Anthropic API.

## Commands

- `npm install` then `npm start` builds the renderer bundles with esbuild (`build.mjs`) and launches Electron.
- `npm test` runs the node:test suites in `test/` (file formats and the formula engine). Run it before every commit.
- `npm run build` must pass with no errors; `npm run dist:win` builds the Windows installer into `release/`.

## Layout

- `main/`: Electron main process. `main.js` (windows, IPC, dialogs), `preload.js` (the `window.office` bridge), `claude.js` (streams from the Anthropic SDK; the API key never leaves this process), `settings.js` (settings and the encrypted key), `formats/` (.docx, .xlsx/.csv, .pptx conversion).
- `common/`: code shared by main and renderer (cell references, CSV).
- `src/shared/`: ribbon, app shell and File screen, Claude pane, original SVG icons, shared CSS.
- `src/docs/`, `src/sheets/`, `src/slides/`, `src/home/`: one folder per app.

## Rules

- Clean-room only. Never copy or decompile Microsoft Office code, icons, logos, fonts or other assets, and don't use Microsoft product names in the UI. A similar layout (ribbon, tabs, File screen) is fine; draw new icons in `src/shared/icons.js`.
- The renderer is sandboxed (contextIsolation, CSP). Anything that needs Node or the network goes through an IPC handler in `main/` and the `window.office` bridge.
- Claude calls go through `main/claude.js` with the official `@anthropic-ai/sdk`. Default model `claude-opus-5-5`. Users sign in with an Anthropic Console API key; don't add Claude.ai login (Anthropic doesn't allow it for third-party apps).
- Match the surrounding code style: plain ES modules, small helpers, few comments.
