# Rea Office

An installable desktop office suite with Claude built in:

- **Rea Docs**: a word processor that opens and saves `.docx`, plus HTML, Markdown and plain text.
- **Rea Sheets**: a spreadsheet with formulas, multiple sheets, fill handle, sorting and `.xlsx`/`.csv` support.
- **Rea Slides**: a presentation editor with themes, layouts, shapes, images, speaker notes and a full-screen slide show. It saves `.reaslides` and exports `.pptx`.

Every app has a familiar ribbon toolbar, a File screen (New, Open, Save, Export, Print, Options), a status bar and a **Claude** tab and side pane.

## What Claude can do

| App | Claude features |
| --- | --- |
| Docs | Draft from a description, continue writing, improve or shorten a selection, change tone, summarize, proofread with one-click corrections, translate, chat about the document |
| Sheets | Write a formula for the active cell, explain a formula, analyze the data, generate a table, clean up a messy selection |
| Slides | Write a whole deck from a topic, improve the current slide, suggest the next slide, write speaker notes for every slide, and **What to say** during a slide show: a button on the bottom bar (or the S key) shows a short script for the slide on screen that follows along as you change slides |

Claude runs through your own Anthropic account: see [Connect Claude](#connect-claude) below.

The default model is Claude Opus 5.5 with medium effort; you can switch to Sonnet 5.5 or Haiku 5.5 and change the effort in Options.

## Download

Go to [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases/latest) and download the installer for your computer:

| System | File |
| --- | --- |
| Windows 10/11 | `Rea-Office-Setup-<version>.exe` (works on x64 and ARM) |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

The builds aren't code-signed yet, so Windows SmartScreen warns the first time: choose **More info**, then **Run anyway**. On macOS, right-click the app and choose **Open**.

## Connect Claude

1. Open any app and go to **File > Options** (or press Ctrl+J to open the Claude pane).
2. Click **Sign in and create a key**. This opens the Anthropic Console in your browser, where you sign in with your Anthropic account and create an API key.
3. Paste the key and click **Connect**. Rea Office checks the key with Anthropic before saving it.

The key is encrypted with your operating system's keychain (Electron `safeStorage`) and is only sent to Anthropic. **Sign out** removes it. You can also set the `ANTHROPIC_API_KEY` environment variable instead.

Why an API key and not a Claude.ai login? Anthropic doesn't allow third-party apps to offer Claude.ai (Pro/Max) login, so Rea Office uses the official API-key sign-in from the Anthropic Console. API usage is billed to your Console account.

## Build it yourself

You need [Node.js](https://nodejs.org/) 22 or newer and Git.

```bash
git clone https://github.com/amitran4812/Reverse-Engineer_365.git
cd Reverse-Engineer_365
npm install
npm start          # build the app and launch it
npm test           # file format and formula engine tests
npm run dist:win   # build the Windows installer into release/
```

`npm run dist:mac` and `npm run dist:linux` build the other installers (each on its own operating system). `npm run watch` rebuilds the screens on change; reload the window with Ctrl+R.

### Releases

The **Build** workflow (`.github/workflows/build.yml`) tests every push and pull request and builds installers for Windows, macOS and Linux as workflow artifacts. To publish them as a GitHub Release, bump `version` in `package.json`, then either push a matching tag (`git tag v0.2.0 && git push origin v0.2.0`) or open **Actions > Build > Run workflow** and tick **release**.

### Working on it with Claude Code

The repo has a `CLAUDE.md` that explains the layout and conventions to [Claude Code](https://code.claude.com/docs). Clone the repo, run `claude` in the folder, and sign in to Claude Code the usual way. Then ask it to add features or fix bugs.

### Layout

```
main/            Electron main process
  main.js        windows, menus, IPC, open/save/export dialogs
  preload.js     the window.office bridge exposed to the renderer
  claude.js      streams Claude responses (the API key stays in this process)
  settings.js    settings + encrypted API key
  formats/       .docx, .xlsx/.csv and .pptx conversion
common/          helpers shared by main and renderer (cell references, CSV)
src/
  shared/        ribbon, app frame, File screen, Claude pane, icons, styles
  home/          start screen
  docs/          word processor (TipTap / ProseMirror)
  sheets/        spreadsheet grid and formula engine
  slides/        presentation editor
test/            node:test suites
build/icon.*     app icon
.github/         Build workflow (tests, installers, releases)
```

## Built on

Open-source components only: [Electron](https://www.electronjs.org/), [TipTap](https://tiptap.dev/)/ProseMirror, [fast-formula-parser](https://github.com/LesterLyu/fast-formula-parser), [docx](https://github.com/dolanmiu/docx), [mammoth](https://github.com/mwilliamson/mammoth.js), [ExcelJS](https://github.com/exceljs/exceljs), [PptxGenJS](https://github.com/gitbrent/PptxGenJS), [marked](https://marked.js.org/) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

The look follows the general layout conventions of desktop office suites (ribbon tabs, a File screen, a status bar). All icons, the app icon, colours and code are original; nothing is taken from Microsoft Office or any other proprietary product. Microsoft, Word, Excel and PowerPoint are trademarks of Microsoft Corporation; Rea Office is not affiliated with Microsoft. File formats are handled through the open libraries above.

## Known limits (first version)

- Docs shows pages as one continuous sheet with page markers rather than true pagination; headers, footers, comments and track changes aren't supported yet.
- Sheets has no charts, merged cells or conditional formatting yet, and the grid starts at 200 rows by 26 columns (it grows as you add data).
- Slides can't import `.pptx` yet (export works) and has no animations or transitions.

## License

MIT. See [LICENSE](LICENSE).
