# Rea Office

An installable desktop office suite with Claude built in:

- **Rea Docs**: a word processor that opens and saves `.docx`, plus HTML, Markdown and plain text.
- **Rea Sheets**: a spreadsheet with formulas, multiple sheets, fill handle, sorting and `.xlsx`/`.csv` support.
- **Rea Slides**: a presentation editor with themes, layouts, shapes, images, speaker notes and a full-screen slide show. It saves `.reaslides` and exports `.pptx`.

- **Claude app**: on the start screen, type what you need ("a 10-slide pitch deck for…", "a monthly budget…") and attach PDFs, images, Word, Excel, CSV or text files. Claude makes the presentation, spreadsheet or document and opens it in the right app.
- **Google Drive and OneDrive**: open and save files in your cloud drives. Google Sheets stay live while open: your edits (and Claude's) show up in Google Sheets within a second, and edits made in Google Sheets show up in Rea Sheets.

Every app has a familiar ribbon toolbar, a File screen (New, Open, Save, Export, Print, Options), a status bar and a **Claude** tab and side pane.

## What Claude can do

| App | Claude features |
| --- | --- |
| Docs | Draft from a description, continue writing, improve or shorten a selection, change tone, summarize, proofread with one-click corrections, translate, chat about the document |
| Sheets | Write a formula for the active cell, explain a formula, analyze the data, generate a table, clean up a messy selection |
| Claude app | Make a deck, spreadsheet or document from a command and any attached files, then refine it by chatting |
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

## Google Drive and OneDrive

Open from the cloud with **File > Open > Google Drive / OneDrive** (or **Open** on the start screen), and save into a cloud folder with **File > Save As**. A file opened from the cloud saves back to the same place with Ctrl+S.

| Source | What happens |
| --- | --- |
| Excel (.xlsx), Word (.docx), CSV, text, .reaslides | Downloaded, edited, and uploaded back when you save |
| Google Docs | Opened as .docx; saving converts it back into the same Google Doc |
| Google Sheets | Opened live: cell values and formulas sync both ways every few seconds while the workbook is open, including tabs you add, rename or delete. Formatting changes stay local. |

Sign-in uses each provider's official OAuth flow for desktop apps (your browser opens, you approve, and Rea Office keeps an encrypted token). Rea Office only talks to Google and Microsoft directly; nothing goes through a third-party server.

### Register the app with Google and Microsoft

Each copy of Rea Office needs an OAuth client ID from Google and from Microsoft. Enter them in **File > Options > Cloud storage > App registration**. To ship them inside the installers instead, add them as repository secrets (`REA_GOOGLE_CLIENT_ID`, `REA_GOOGLE_CLIENT_SECRET`, `REA_MICROSOFT_CLIENT_ID`); the Build workflow bakes them into `main/cloud-config.json`. You can also set the same names as environment variables.

**Google (Drive and Sheets)**

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. Under **APIs & Services > Library**, enable the **Google Drive API** and the **Google Sheets API**.
3. Under **Google Auth Platform**, set up the consent screen: user type **External**, then add your Google account under **Audience > Test users**.
4. Under **Data access**, add the scopes `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/spreadsheets`.
5. Under **Clients**, create a client of type **Desktop app** and copy the client ID and client secret.

While the app is in "Testing", only the test users you add can sign in, and Google asks them to sign in again every 7 days. Opening it to everyone needs Google's verification for the Drive scope.

**Microsoft (OneDrive)**

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), open **App registrations > New registration**.
2. For supported account types, choose **Accounts in any organizational directory and personal Microsoft accounts**.
3. Add a redirect URI with platform **Public client/native (mobile & desktop)** and the value `http://localhost`.
4. Under **API permissions**, add the Microsoft Graph delegated permissions `Files.ReadWrite.All`, `User.Read` and `offline_access`.
5. Copy the **Application (client) ID**. No client secret is needed.

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
  attachments.js files attached to Claude messages (PDF, images, Office files, text)
  generated.js   opens what the Claude app made in Docs, Sheets or Slides
  cloud/         Google Drive, Google Sheets live sync and OneDrive (OAuth + APIs)
  settings.js    settings + encrypted API key
  formats/       .docx, .xlsx/.csv and .pptx conversion
common/          helpers shared by main and renderer (cell references, CSV)
src/
  shared/        ribbon, app frame, File screen, Claude pane, icons, styles
  home/          start screen and the Claude app
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
- Slides can't import `.pptx` yet (export works) and has no animations or transitions, so Google Slides files aren't listed in the cloud browser.
- Live Google Sheets sync covers values and formulas; formatting, column widths and merged cells don't sync.
- The Claude app reads PDF, images, .docx, .xlsx, CSV and text attachments (not .pptx yet).

## License

MIT. See [LICENSE](LICENSE).
