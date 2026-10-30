# Work

An installable desktop office suite with AI built in (Claude by default, or OpenAI or Gemini with your own key):

- **Write**: a word processor that opens and saves `.docx`, plus HTML, Markdown and plain text, and opens OpenDocument `.odt`. It also has a **LaTeX mode** for `.tex` projects: files, code and a live PDF preview side by side (see [LaTeX projects](#latex-projects)), and a **Notes mode** for quick notes: switch with **Document / Notes** at the top right, or start with **New > Notes**. Every new line is a bullet, `/` inserts checklists, tables, drawings and plots, and the page can be lined, grid or dotted in six colours. Draw with a mouse, finger or stylus (pen pressure works), and double-click a picture to draw on it. **Send to Present** turns a document's text, lists, pictures and tables into a new presentation, designed by the AI you've connected or laid out one slide per heading without one.
- **Plot**: a spreadsheet with formulas, multiple sheets, fill handle, sorting, `.xlsx`/`.csv`/`.ods` open and save, and `.xls`, `.xlsm` and `.xltx` open. Its **Analysis** tab plots large data files, and **Send to Present** puts the plots you pick, with a table of rows if you like, on a slide in a new presentation.
- **Present**: a presentation editor with themes, layouts, shapes, images, speaker notes and a full-screen slide show. It saves `.reaslides`, exports `.pptx`, and opens `.pptx` and OpenDocument `.odp`.

- **Claude app**: on the start screen, type what you need ("a 10-slide pitch deck for…", "a monthly budget…") and attach PDFs, images, Word, Excel, CSV or text files. Claude makes the presentation, spreadsheet or document and opens it in the right app.
- **Google Drive and OneDrive**: open and save files in your cloud drives. Google Sheets stay live while open: your edits (and Claude's) show up in Google Sheets within a second, and edits made in Google Sheets show up in Plot.
- **Share**: the Share button in every app invites people by email with edit or view access, through Google Drive or OneDrive.
- **Other AIs**: connect OpenAI (ChatGPT models) or Gemini with your own API key and every AI feature works the same way. Claude stays the default.
- **Windows integration**: Write, Plot and Present each get their own Start menu and desktop shortcut, icon and taskbar group. Right-click a file for **Open in Write / Plot / Present**, or use **Open with**, and **New > Write document / Plot workbook / Present presentation** in Explorer.
- **Accounts**: keep personal, college and work apart. Add as many accounts as you like; each has its own Claude key, cloud sign-ins, recent files, history and cache.

Every app has a familiar ribbon toolbar, a File screen (New, Open, Save, Export, Print, Options), a status bar and a **Claude** tab and side pane.

## What Claude can do

| App | Claude features |
| --- | --- |
| Write | Draft from a description, continue writing, improve or shorten a selection, change tone, summarize, proofread with one-click corrections, translate, chat about the document, and **Send to Present**: design a presentation from the document, with short bullets, speaker notes and your pictures and tables placed on the slides |
| Write (Notes) | Summarize notes into key points, decisions and action items; pull out action items as a checklist; tidy up rough notes; turn a web link into notes; insert a plot or a picture from a typed instruction (pictures use an OpenAI or Gemini key's image model when one is saved, otherwise the chat AI draws an illustration) |
| Write (LaTeX) | **LaTeX helper**: write LaTeX from a description ("a 3-column table of results"), turn data into a table, convert plain text or math to LaTeX, explain a command, answer "which command do I need?", improve the wording without touching commands, and fix compile errors |
| Plot | Write a formula for the active cell, explain a formula, analyze the data, generate a table, clean up a messy selection |
| Claude app | Make a deck, spreadsheet or document from a command and any attached files, then refine it by chatting |
| Present | Write a whole deck from a topic, improve the current slide, suggest the next slide, write speaker notes for every slide, and **What to say** during a slide show: a short script for the slide on screen, shown at the bottom and different for each slide, that follows along as you change slides. Turn it on or off with the **What to say** button on the slide show bar, the S key, **Slide Show > What to say On/Off**, or **File > Options > AI assistant**; your choice is remembered |

Claude runs through your own Anthropic account: see [Connect Claude](#connect-claude) below.

The default model is Claude Opus 5.5 with medium effort; you can switch to Sonnet 5.5 or Haiku 5.5 and change the effort in Options.

## Download

Go to [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases/latest) and download the installer for your computer:

| System | File |
| --- | --- |
| Windows 10/11 | `Work-Setup-<version>.exe` (works on x64 and ARM) |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

The builds aren't code-signed yet, so Windows SmartScreen warns the first time: choose **More info**, then **Run anyway**. On macOS, right-click the app and choose **Open**. [SIGNING.md](SIGNING.md) explains how to sign the Windows installer (see the [Code signing policy](#code-signing-policy)), and [CHANGELOG.md](CHANGELOG.md) lists what each version adds.

Work updates itself from this repository's [releases](https://github.com/amitran4812/Reverse-Engineer_365/releases): it checks when it starts and every few hours, downloads the new version in the background, and offers **Restart and update**. Turn automatic checks off, or check by hand, in File > Options > Updates. In-place updates work with the Windows installer and the Linux AppImage; on macOS and with the .deb, Work tells you about the new version and opens the releases page.

To uninstall, use Settings > Apps > Installed apps > Work. The installer and uninstaller close any running copy of Work first. If an old version won't uninstall, end every `Work.exe` in Task Manager (or run `taskkill /F /T /IM Work.exe`), then run `%LOCALAPPDATA%\Programs\Work\Uninstall Work.exe`. Your accounts and settings stay in `%APPDATA%\Rea Office` unless you delete that folder.

## Opening files

| App | Opens and saves | Opens (save as a supported format) |
| --- | --- | --- |
| Write | `.docx`, `.html`, `.md`, `.txt`, `.tex` (as a LaTeX project) | `.odt` |
| Plot | `.xlsx`, `.csv`, `.ods` | `.xls`, `.xlsm` (macros are dropped), `.xltx` |
| Present | `.reaslides` (export `.pptx`) | `.pptx`, `.odp` |

Imported presentations keep slide titles, text, two-column layouts and speaker notes; images, charts, animations and exact positions don't come across yet. Legacy Word `.doc` and PowerPoint `.ppt` files don't open yet: save them as `.docx` or `.pptx` first.

On Windows the installer registers these types, so **Open with** lists Write, Plot and Present, and the right-click menu has **Open in Write / Plot / Present** (on Windows 11 it's under **Show more options**). It only becomes the default app for a type that has no other app, and `.reaslides`. Pick defaults yourself in **Settings > Apps > Default apps > Work**. **New > Write document** (and Plot, Present) appears in Explorer when no other app already provides a new-file entry for that type.

## LaTeX projects

Write opens a `.tex` file, or a folder (**File > Open > LaTeX project folder**, or **New > LaTeX project**), as a LaTeX project. A zipped project, such as one downloaded from an online LaTeX editor, opens with **New > Upload LaTeX (.zip)**: Work unpacks it into a folder next to the .zip, finds the main `.tex` file and compiles it. The workspace has an editor, a PDF preview and a Files pop-up:

- **Files**: opens from the **Files** tab next to File, Home and View, or from the **Files** button in the bottom-left corner. It lists the project's `.tex`, `.bib`, image and other files with an outline of the open file's sections. **Upload** adds files, the contents of a .zip, or starts a new project from a .zip; you can also drop files or a .zip onto the list. Drag files between folders, right-click to rename, delete or **Set as main file**. Pin it to keep it open as a pane beside the editor.
- **Code**: syntax highlighting, and suggestions as you type: `\cite{` lists the keys in your `.bib` files (with author, year and title), `\ref{`, `\eqref{`, `\cref{` and friends list every `\label`, `\begin{` offers environments and fills in the matching `\end`, `\includegraphics{` and `\input{` list project files, and `\` suggests common commands and the ones you defined with `\newcommand`. Ctrl+F finds and replaces, Ctrl+/ comments lines, Ctrl+B and Ctrl+I make bold and italic.
- **PDF preview**: compiles as you type (or press Ctrl+Enter / Ctrl+S). Errors and warnings show in **Logs** and in the editor margin; click one to jump to the line, or ask the AI to fix them. Double-click the PDF to jump to that spot in the code, and **Show in PDF** (Ctrl+Shift+L) goes the other way.

Compiling uses [Tectonic](https://tectonic-typesetting.github.io/), a self-contained LaTeX engine that the installer includes along with the common packages (amsmath, graphicx, hyperref, BibTeX and natbib, tikz/pgfplots, beamer, IEEEtran and more), so projects compile offline. A package it doesn't have yet is downloaded once the first time a document uses it. If you have MiKTeX or TeX Live installed, pick latexmk, pdfLaTeX, XeLaTeX or LuaLaTeX from the arrow next to **Recompile**. Build files go to Work's own data folder, so your project folder stays clean.

## Connect Claude

1. Open any app and go to **File > Options** (or press Ctrl+J to open the Claude pane).
2. Click **Sign in and create a key**. This opens the Anthropic Console in your browser, where you sign in with your Anthropic account and create an API key.
3. Paste the key and click **Connect**. Work checks the key with Anthropic before saving it.

The key is encrypted with your operating system's keychain (Electron `safeStorage`) and is only sent to Anthropic. **Sign out** removes it. You can also set the `ANTHROPIC_API_KEY` environment variable instead.

### Use ChatGPT, OpenAI or Gemini instead

**ChatGPT (no key):** in **File > Options > AI assistant**, click **Sign in with ChatGPT**, sign in in your browser, pick a model and **Save**. Work then uses your ChatGPT Plus or Pro plan through OpenAI's Sign in with ChatGPT for open-source apps, so there's nothing to pay separately and no key to copy. Usage counts toward your plan's limits, and you can cap or disconnect Work in ChatGPT's settings.

**API keys:** click **Get a key**, create and copy a key on the provider's page, and come back to Work: it fills the copied key in and checks it for you. Or paste an OpenAI key ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)) or a Gemini key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)), click **Check key and list models**, pick a model and **Save**. Then choose it under **Use for AI features**, or switch from the menu at the top of any AI pane. The Claude app, every side pane, What to say and file attachments (PDF, images, Office files, text) work with each provider; structured results use each provider's JSON schema output. Keys are encrypted and kept per account, and each is only sent to its own provider.

Why an API key for Claude and Gemini? Anthropic doesn't allow third-party apps to offer Claude.ai (Pro/Max) login, so Work uses the official API key from the Anthropic Console, billed to your Console account. Gemini's Google sign-in for the API bills the app publisher's Cloud project rather than you, so Work uses your own Gemini key (free tier available in Google AI Studio). ChatGPT is the one provider that lets an open-source app use your own plan by signing in.

## Google Drive and OneDrive

Open from the cloud with **File > Open > Google Drive / OneDrive** (or **Open** on the start screen), and save into a cloud folder with **File > Save As**. A file opened from the cloud saves back to the same place with Ctrl+S.

| Source | What happens |
| --- | --- |
| Excel (.xlsx), Word (.docx), CSV, text, .reaslides | Downloaded, edited, and uploaded back when you save |
| Google Docs | Opened as .docx; saving converts it back into the same Google Doc |
| Google Sheets | Opened live: cell values and formulas sync both ways every few seconds while the workbook is open, including tabs you add, rename or delete. Formatting changes stay local. |

Sign-in uses each provider's official OAuth flow for desktop apps (your browser opens, you approve, and Work keeps an encrypted token). Work only talks to Google and Microsoft directly; nothing goes through a third-party server.

### Share with people

Click **Share** in the title bar. Type one or more email addresses, choose **Can edit** or **Can view**, add a message if you like, and click **Send invite**. Google or Microsoft emails the people you invite, and they open the file with their own account. The same box lists everyone who has access, lets you remove someone, and copies the file's link. A file that isn't in the cloud yet is saved to Google Drive or OneDrive first. Work uses the Drive permissions API and the Microsoft Graph invite API, so there's no server of its own, and your organization's sharing rules still apply.

When the shared file is a Google Sheet, everyone with it open in Plot or Google Sheets sees edits live.

## Accounts (personal, college, work)

Click your name at the bottom left of the start screen to switch accounts, add one, or manage them (also under **File > Options > Accounts**). Each account is fully separate on this computer: its own Claude API key, Google and Microsoft sign-ins, recent files, downloaded copies, browser storage and settings live in their own folder, and nothing is copied or suggested across accounts. Each account opens in its own windows, so you can have Personal and Work open side by side, and every window shows which account it belongs to. On Windows, each account gets its own taskbar group with **New in Write / Plot / Present** in the jump list.

For a work or school account, open **File > Options > Cloud storage > Organization and app registration** in that account and enter:

- **OneDrive**: your organization's domain (for example `contoso.com`) or tenant ID. You then sign in through your organization's own Microsoft 365 sign-in, so its conditional access, sharing and data policies apply. Your IT admin may need to approve the app, or register their own app ID (enter it in the same place).
- **Google Drive**: your Google Workspace domain (for example `college.edu`). Sign-in only accepts accounts from that domain.

Removing an account deletes its data from this computer (key, sign-ins, recent list and cached copies). Files in your folders, Google Drive or OneDrive aren't touched. The first account keeps the app's original settings and can be renamed but not removed.

### Register the app with Google and Microsoft

Whoever publishes Work registers it once with Google and Microsoft and adds the IDs as repository secrets. Every installer built after that has the sign-in built in: people just click **Connect** and sign in with their own Google or Microsoft account, with nothing to set up. Without the secrets, each person has to register their own app as below.

What the publisher needs to know:

- **Google:** while the app is in Testing, only the test users you list (up to 100) can sign in, and they sign in again every 7 days. To open it to everyone, publish the app and pass Google's verification. Full Drive access (`drive`) is a restricted scope, so verification includes a yearly third-party security assessment; Sheets access needs the standard review.
- **Microsoft:** no review is needed. Personal Microsoft accounts can sign in as soon as the app is registered as below. Some colleges and companies only let people approve apps from verified publishers, or need an admin to approve Work once; Publisher verification in Entra covers the first case.

Each copy of Work needs an OAuth client ID from Google and from Microsoft. Enter them in **File > Options > Cloud storage > App registration**. To ship them inside the installers instead, add them as repository secrets (`REA_GOOGLE_CLIENT_ID`, `REA_GOOGLE_CLIENT_SECRET`, `REA_MICROSOFT_CLIENT_ID`); the Build workflow bakes them into `main/cloud-config.json`. You can also set the same names as environment variables.

**Google (Drive and Sheets)**

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. Under **APIs & Services > Library**, enable the **Google Drive API** and the **Google Sheets API**.
3. Under **Google Auth Platform**, set up the consent screen: user type **External**, then add your Google account under **Audience > Test users**.
4. Under **Data access**, add the scopes `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/spreadsheets`.
5. Under **Clients**, create a client of type **Desktop app** and copy the client ID and client secret.

While the app is in "Testing", only the test users you add can sign in, and Google asks them to sign in again every 7 days. Opening it to everyone needs Google's verification for the Drive scope.

If Google only lets college or work accounts sign in:

- **"Error 403: org_internal"** or **"can only be used within its organization"**: the consent screen's user type is **Internal**. This happens when the Cloud project belongs to a college or company Google Workspace. Open **Google Auth Platform > Audience** and choose **Make external**. If that isn't allowed, create the project while signed in to the console with your personal Gmail account, and use that project's client ID.
- **"has not completed the Google verification process"** or **"Access blocked"**: add the Gmail address under **Audience > Test users**.
- **The account chooser only accepts one domain**: clear the college or work domain in **File > Options > Cloud storage**, or click **Use any Google account**. Each Work account has its own setting, so a College account can keep its domain while Personal accepts any Gmail address.

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

`npm run tectonic` downloads the LaTeX engine into `build/tectonic` and fills its package cache; the `dist` scripts run it for you. Without it, LaTeX mode uses MiKTeX or TeX Live if they're installed.

`npm run dist:mac` and `npm run dist:linux` build the other installers (each on its own operating system). `npm run watch` rebuilds the screens on change; reload the window with Ctrl+R.

### Releases

The **Build** workflow (`.github/workflows/build.yml`) tests every push and pull request and builds installers for Windows, macOS and Linux as workflow artifacts. To publish them as a GitHub Release, bump `version` in `package.json`, then either push a matching tag (`git tag v0.2.0 && git push origin v0.2.0`) or open **Actions > Build > Run workflow** and tick **release**.

### Layout

```
main/            Electron main process
  main.js        windows, menus, IPC, open/save/export dialogs
  preload.js     the window.office bridge exposed to the renderer
  claude.js      streams Claude responses (the API key stays in this process)
  attachments.js files attached to Claude messages (PDF, images, Office files, text)
  generated.js   opens what the Claude app made in Write, Plot or Present, and slides Plot and Write send to Present
  links.js       reads a public web page for Write's "Notes from a link"
  cloud/         Google Drive, Google Sheets live sync and OneDrive (OAuth + APIs)
  settings.js    settings + encrypted API key
  profiles.js    accounts: one data folder and process per account
  ai.js          OpenAI and Gemini (same streaming contract as claude.js)
  formats/imports.js  reads .pptx, .odp, .odt, .xls, .ods
  formats/       .docx, .xlsx/.csv and .pptx conversion
  latex.js       LaTeX projects: files, compiling with Tectonic or a TeX install
common/          helpers shared by main and renderer (cell references, CSV, LaTeX parsing)
src/
  shared/        ribbon, app frame, File screen, Claude pane, icons, styles
  home/          start screen and the Claude app
  docs/          word processor (TipTap / ProseMirror)
  latex/         Write's LaTeX mode (CodeMirror editor, pdf.js preview)
  sheets/        spreadsheet grid and formula engine
  slides/        presentation editor
scripts/         fetch-tectonic.mjs: bundles the LaTeX engine into the installer
test/            node:test suites
build/icon.*     app icon
.github/         Build workflow (tests, installers, releases)
```

## Built on

Open-source components only: [Electron](https://www.electronjs.org/), [TipTap](https://tiptap.dev/)/ProseMirror, [fast-formula-parser](https://github.com/LesterLyu/fast-formula-parser), [docx](https://github.com/dolanmiu/docx), [mammoth](https://github.com/mwilliamson/mammoth.js), [ExcelJS](https://github.com/exceljs/exceljs), [PptxGenJS](https://github.com/gitbrent/PptxGenJS), [marked](https://marked.js.org/), [CodeMirror](https://codemirror.net/), [pdf.js](https://mozilla.github.io/pdf.js/), [Tectonic](https://tectonic-typesetting.github.io/) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

The look follows the general layout conventions of desktop office suites (ribbon tabs, a File screen, a status bar). All icons, the app icon, colours and code are original; nothing is taken from Microsoft Office or any other proprietary product. Microsoft, Word, Excel and PowerPoint are trademarks of Microsoft Corporation; Work is not affiliated with Microsoft. File formats are handled through the open libraries above.

## Known limits

- Write shows pages as one continuous sheet with page markers rather than true pagination; headers, footers, comments and track changes aren't supported yet.
- Plot has no charts, merged cells or conditional formatting yet, and the grid starts at 200 rows by 26 columns (it grows as you add data).
- Present has no animations or transitions, and Google Slides files aren't listed in the cloud browser.
- Live Google Sheets sync covers values and formulas; formatting, column widths and merged cells don't sync.
- The Claude app reads PDF, images, .docx, .xlsx, CSV and text attachments (not .pptx yet).
- `.xls` is read with SheetJS (the `@e965/xlsx` npm build of SheetJS 0.20.3); formulas and values come across, formatting doesn't.
- LaTeX mode runs BibTeX but not Biber, so `biblatex` projects need a MiKTeX or TeX Live install (pick it from the Recompile menu). Shell escape (for `minted`) is off. `.tex` isn't registered as a Windows file type, so open projects from Work.
- The Windows integration (shortcuts, Open with, New menu) is built into the installer but hasn't been tried on every Windows version yet.

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org) (once the application is approved; until then the Windows installer is unsigned).

- Only installers built by this repository's GitHub Actions workflow from the public source code are signed, and every release is approved by hand before it is signed.
- Committers and reviewers: [amitran4812](https://github.com/amitran4812)
- Approvers: [amitran4812](https://github.com/amitran4812)

### Privacy

Work doesn't collect telemetry or send anything to the project. It connects to other services only for features you turn on:

- AI features send your prompt, and any files or document text you attach, to the provider you choose with your own key: Anthropic (Claude), OpenAI or Google (Gemini).
- Google Drive, Google Sheets and OneDrive are contacted only after you sign in to them, to open, save and share the files you pick.
- Compiling LaTeX with the built-in engine can download LaTeX packages it doesn't have yet from the Tectonic project's package server.
- Update checks download release information and installers from this repository's GitHub Releases. You can turn them off in File > Options > Updates.

Keys and sign-in tokens are stored encrypted on your computer and are never sent anywhere except to the provider they belong to.

## License

MIT. See [LICENSE](LICENSE).
