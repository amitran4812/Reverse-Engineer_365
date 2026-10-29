# What's new in Work

Each version of Work and what it adds or fixes. The newest version is at the top. Download any version from [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases). From 0.2.4 on, Work updates itself.

## 0.2.5: LaTeX in Write

- Write opens `.tex` files and LaTeX project folders in a three-part workspace: a file list with an outline, an editor, and a PDF preview that refreshes as you type.
- Suggestions as you type: citation keys from your `.bib` files, labels for `\ref`, environments (the matching `\end` is added for you), packages, commands and your own `\newcommand`s.
- Compile errors and warnings appear in a Logs panel and next to the line they're on. Double-click the PDF to jump to the source, or use Show in PDF to go the other way.
- A LaTeX helper in the AI pane writes LaTeX from a description, turns data into tables, converts text or maths, explains code, and fixes compile errors.
- A LaTeX engine (Tectonic) comes built in, so common documents compile offline. MiKTeX or TeX Live are used if you have them.

## 0.2.4: Automatic updates

- Work checks for a new version when it starts and every few hours. It downloads in the background, then a bar offers **Restart and update**. Files and settings are kept.
- File > Options > Updates turns automatic checks off and has a **Check for updates** button.
- If 0.2.3 or older is installed, install 0.2.4 by hand once. After that, Work updates itself.

## 0.2.3: Uninstall fix

- The installer and uninstaller now close any running copy of Work first, so you no longer get "the app is still running" when uninstalling or deleting the folder.
- A new version installs over an old one even if the old uninstaller fails. Leftover Rea Office folders and shortcuts are removed.
- Work exits completely when you close it, even if a window crashed or never finished opening.
- The build can sign the Windows installer once a signing certificate is set up, which removes the "unknown publisher" warning ([SIGNING.md](SIGNING.md)).

## 0.2.2: What to say on/off

- **What to say** (the speaking script at the bottom of a Present slide show) can be turned on or off. Work remembers your choice.
- Change it with the button in the slide show bar, the S key, Slide Show > What to say, or File > Options.

## 0.2.1: Work, Write, Plot and Present

- The suite is now called **Work**, and the apps are **Write** (documents), **Plot** (spreadsheets) and **Present** (presentations). Your settings and accounts carry over.
- On Windows, Write, Plot and Present each get their own Start menu and desktop shortcut and their own icon.
- Right-clicking a file shows "Open in Write", "Open in Plot" or "Open in Present", and the three apps appear under Open with. Right-click > New can create Write, Plot and Present files.
- Use OpenAI (ChatGPT models) or Gemini with your own key instead of Claude, for every AI feature. Claude stays the default.
- More file types open: `.pptx` and `.odp` in Present, `.odt` in Write, and `.xls`, `.xlsm`, `.xltx` and `.ods` in Plot. Plot can also save `.ods`.

## 0.2.0: Cloud, Claude app, sharing and accounts

- Connect Google Drive and OneDrive to open and save files in the cloud. Ctrl+S saves back to where the file came from.
- Google Sheets open live in Plot: values, formulas and tabs sync both ways while the workbook is open.
- A new Claude app on the start screen. Describe what you want, attach files (PDF, images, documents, spreadsheets, CSV), and Claude makes a deck, spreadsheet or document and opens it.
- Attach files to Claude in every app.
- **Share** a cloud file by email with edit or view access, see who has access, and copy the link.
- **Accounts**: add as many as you like, such as Personal, College and Work. Each keeps its own files, history, keys and sign-ins, and nothing mixes between them. Work or school accounts can sign in through their organization.

## 0.1.0: First release

- A word processor, a spreadsheet and a presentation app (then called Rea Docs, Sheets and Slides), with a ribbon, a File screen and Claude built into each.
- Connect Claude with an Anthropic Console API key. The key is checked before it's saved and stored encrypted.
- Installers for Windows, macOS and Linux.
