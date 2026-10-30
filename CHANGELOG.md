# What's new in Work

Each version of Work and what it adds or fixes. The newest version is at the top. Download any version from [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases). From 0.2.4 on, Work updates itself.

## 0.2.12: Combine tables in any sheet

- **Add Rows** on the Data tab stacks another table under the one you're in. Take it from another sheet in the workbook or from a file (Excel, OpenDocument, CSV or TSV). Columns are matched by name, and you can map the rest yourself or leave them out. Optionally add a column that says where each row came from.
- **Add Columns** joins another table on one or more key columns, with a left, inner, right or full join, and lets you pick which of its columns to bring in. Keys are compared as written, so IDs like 007 stay as they are.
- Click anywhere inside your table first: Work finds its edges, with the column names in the first row. The result goes under or next to the table, or on a new sheet. Formulas and formats in your table are kept, formula columns carry on into new rows, and Undo puts everything back.
- **Connect Google Drive** with one click: Work now comes with its own Google sign-in, so you just pick your Google account. No setup in Options.

## 0.2.11: Upload LaTeX projects as a .zip

- **Upload LaTeX (.zip)** on the Home and New screens opens a zipped LaTeX project, like the ones online LaTeX editors download. Work unpacks it next to the .zip, finds the main `.tex` file and compiles it.
- The LaTeX file list is now a **Files** pop-up instead of a pane that always took space. Open it from the Files tab beside File, Home and View, or from the Files button in the bottom-left corner. It shows how many files and folders the project has, and **Upload** adds files or a .zip. Pin it if you prefer a pane.
- Drop a .zip onto the file list to add everything inside it to the project.
- **Connect Google Drive** with one click: Work now comes with its own Google sign-in, so you just pick your Google account. No setup in Options.

## 0.2.10: One-click AI sign-in

- The first time you open the AI pane, **Sign in with ChatGPT** is right there. One click signs you in with your ChatGPT Plus or Pro account and picks a model, so the AI is ready without a key.
- Connecting Claude still needs a key, because Anthropic doesn't let other apps use Claude.ai login. Click the button, copy the key, and come back: Work fills it in.

## 0.2.9: Combine files and a new look for Plot analysis

- **Add rows**: stack another CSV, Parquet or Excel file under your data. Columns are matched by name, and you can map the rest yourself. A Source column records which file each row came from.
- **Add columns**: join another file on one or more key columns, with a left, inner, right or full join, and pick which of its columns to bring in.
- **Data tables** lists the original file and every step applied to it, including added rows, added columns and calculated columns. You can remove any step, and saved analyses replay the steps when you reopen them.
- **Pages**: an analysis can have several pages of plots. Use the tabs above the plots to add, rename, duplicate, reorder or delete pages.
- Change a plot right on its axes: click the X or Y axis name, or **Color by**, to pick a column or an aggregation. You can also drag a column from the data panel onto an axis.
- New **Pie** and **Cross table** visualizations. Click a slice or a cell to mark those rows everywhere.
- A tool rail on the left opens data files, the visualization picker, the data panel, filters, the details table, curve fitting and Claude.
- The details table follows your marking. Filters for the first columns are open as soon as a file loads.

## 0.2.8: Sign in with ChatGPT, keys fill in by themselves

- **Sign in with ChatGPT**: if you have ChatGPT Plus or Pro, click Sign in with ChatGPT in File > Options > AI assistant and use your plan for every AI feature. No API key needed.
- Getting an API key is easier: click **Get a key**, copy the key on the provider's page, and come back. Work fills it in and checks it for Claude, OpenAI and Gemini.
- Google Drive and OneDrive can sign in with Work's own app registration when the installer includes one, so people just click Connect. If you entered your own client ID before, **Use Work's built-in sign-in** switches back.

## 0.2.7: Personal Google accounts

- Connecting Google Drive always shows Google's account chooser, so you can pick your personal Gmail account even when you're signed in to a college or work account in the browser.
- A college or work domain set for an account is now clearly marked. **Use any Google account** (or Microsoft account) removes the limit in one click.
- The README explains what to change in the Google Cloud console if Google only lets college or work accounts sign in.

## 0.2.6: Large-data analysis in Plot

- Plot has a new **Analysis** tab for data far bigger than a sheet can hold. It opens CSV, TSV, Parquet and Excel files with millions of rows in seconds; big files open there automatically.
- Plots: scatter, line, bar, histogram, box plot, heat map and two-axis charts. Zoom, pan, hover for values, color by a column, log axes.
- Drag across any plot to mark rows; the same rows light up in every other plot and in the rows table.
- A Filters panel with range sliders, value checklists and search, plus filter formulas like `[Temp] > 20`. Keep or remove the marked rows.
- Calculated columns from formulas (maths, `if`, running totals, moving averages and more).
- Curve fitting: linear, polynomial, exponential, power, Gaussian, logistic and other models, or your own equation, with R², errors, p-values and confidence intervals. Add fitted values or residuals as columns.
- Export plots as PNG, SVG or PDF and rows as CSV or a new sheet, and save the whole analysis to reopen later.
- Ask Claude to build plots, filters, formulas and fits for you, and undo them in one step.

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
