# Contributing to Work

An Electron desktop suite: Write (word processor), Plot (spreadsheet) and Present (presentations), each with Claude built in through the Anthropic API.

## Commands

- `npm install` then `npm start` builds the renderer bundles with esbuild (`build.mjs`) and launches Electron.
- `npm test` runs the node:test suites in `test/` (file formats and the formula engine). Run it before every commit.
- `npm run build` must pass with no errors; `npm run dist:win` builds the Windows installer into `release/` (it first runs `scripts/fetch-tectonic.mjs`, which bundles the Tectonic LaTeX engine and a warmed package cache from `build/tectonic/`).

## Layout

- `main/`: Electron main process. `main.js` (windows, IPC, dialogs), `preload.js` (the `window.office` bridge), `claude.js` (streams from the Anthropic SDK; the API key never leaves this process), `settings.js` (settings, the encrypted key and cloud tokens), `formats/` (.docx, .xlsx/.csv, .pptx conversion), `attachments.js` (files attached to Claude messages), `generated.js` (opens what the Claude app made), `cloud/` (OAuth loopback + PKCE, Google Drive/Sheets and OneDrive via Graph, sharing), `updates.js` (electron-updater from this repo's GitHub Releases; the workflow must upload `latest.yml`, `latest-linux.yml` and the blockmaps), `profiles.js` (accounts: each has its own userData folder and runs as its own process, set before app ready), `links.js` (reads a public web page for Write's Notes from a link), `latex.js` (LaTeX projects: file access limited to the project folder, compiles in a mirror under userData with the bundled Tectonic or a TeX install).
- `common/`: code shared by main and renderer (cell references, CSV, `latex.js` for completion context, labels, .bib keys, logs and SyncTeX).
- `src/shared/`: ribbon, app shell and File screen, Claude pane, original SVG icons, shared CSS.
- `src/docs/`, `src/sheets/`, `src/slides/`, `src/home/`: one folder per app. `src/home/make.js` is the Claude app; `src/shared/cloud.js` is the cloud browser, Share dialog and Options section; `src/shared/accounts.js` is the account switcher; live Google Sheets sync lives at the end of `src/sheets/sheets.js`. Plot's formulas run in `src/sheets/formula/` (parser, evaluator with array spilling, and the Google Sheets function library in `fns/`); live data for GOOGLEFINANCE and the IMPORT functions is fetched by `main/webdata.js`, and `common/gsheets.js` reads and writes the wrapped form Google Sheets uses for its own functions in .xlsx files. `src/docs/notes.js` is Write's Notes mode (auto bullets, `/` menu, paper, AI notes tools) with `ink.js` (drawing pad), `notes-chart.js` (plots drawn with Plot's painter) and `notes-data.js` (plain helpers, tested). `src/latex/` is Write's LaTeX mode (its own `latex.html` page, opened for `.tex` projects): CodeMirror editor and suggestions, pdf.js preview. Send to Present lives in `src/docs/to-present.js` with the deck planner in `deck.js`; `tex-deck.js` reads a LaTeX project into the same blocks for it.

## Rules

- Clean-room only. Never copy or decompile Microsoft Office code, icons, logos, fonts or other assets, and don't use Microsoft product names in the UI. A similar layout (ribbon, tabs, File screen) is fine; draw new icons in `src/shared/icons.js`.
- The renderer is sandboxed (contextIsolation, CSP). Anything that needs Node or the network goes through an IPC handler in `main/` and the `window.office` bridge.
- Claude calls go through `main/claude.js` with the official `@anthropic-ai/sdk`. OpenAI and Gemini (optional, user's own key) and ChatGPT (Sign in with ChatGPT for open-source apps, `main/chatgpt.js`: user's own Plus/Pro plan via the Responses API, stream on, store off) live in `main/ai.js` and keep the same contract: stream text, honour the JSON schema, accept attachments. Default model `claude-opus-5-5`. Users sign in with an Anthropic Console API key; don't add Claude.ai login (Anthropic doesn't allow it for third-party apps).
- Cloud tokens and API calls stay in the main process (`main/cloud/`). Use the providers' official OAuth for installed apps; never ship a client secret that isn't meant for desktop apps.
- The apps are named Write, Plot and Present in the UI; the code keeps the ids `docs`, `sheets` and `slides`.
- Windows shortcuts, file associations and the New menu are in `build/installer.nsh`; per-app icons are in `build/apps/`. The installer and window ids use `tools.rea.office.*`, the data folder stays `Rea Office`, and the suite is called Work in the UI.
- Accounts never share data: anything stored goes under `app.getPath('userData')`, never a fixed path.
- Match the surrounding code style: plain ES modules, small helpers, few comments.
