# What's new in Work

Each version of Work and what it adds or fixes. The newest version is at the top. Download any version from [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases). From 0.2.4 on, Work updates itself.

## 0.2.34: PowerPoint files open the way they look

- **Opening a .pptx keeps its design.** Present now reads the whole file instead of just its text: the slide size, the template's backgrounds and artwork from the master and layouts, theme colours and fonts, and every slide, the first one included.
- Text keeps its fonts, sizes, colours, bold and italic, alignment, line and paragraph spacing, and the deck's own bullets and numbering at each level.
- Pictures (with their crops), shapes and their outlines, lines and arrows, grouped objects, tables with their cell colours and borders, charts (column, bar, line, area, pie and doughnut) and SmartArt come across in place.
- Template artwork stays behind the slide content, so it can't be moved by accident. **New Slide** and **Layout** use the deck's own layouts.
- Formatting a whole text box from the ribbon still works on opened slides, and saving back to `.pptx` keeps the slide size, backgrounds and fonts.

## 0.2.26: Write anywhere, voice notes, equations and attachments in notes

- **Write anywhere**: insert an area on the Notes tab (or type `/anywhere`) and click anywhere in it to start a text box. Drag a box by its top edge to move it, drag its right edge to make it wider, and drag the bottom of the area to make it taller. Empty boxes tidy themselves away.
- **Voice notes**: record from the Notes tab. The note plays back in the page, and with an OpenAI or Gemini key saved it's turned into text under the player. **Dictate** types what you say at the cursor instead.
- **Transcribe a recording**: pick a meeting or lecture recording (mp3, m4a, wav, mp4 and more, up to 25 MB with OpenAI or 19 MB with Gemini) and its transcript goes into your notes, ready for **Summarize**.
- **Equations**: type TeX with a live preview and buttons for fractions, roots, sums, integrals, matrices, Greek letters and chemistry, or describe the equation ("quadratic formula") and the AI writes it. Double-click an equation to edit it. Equations are on the Insert tab in Document mode too, and stay editable when saved as `.docx`.
- **Attachments**: attach files to notes (up to 25 MB each) from the Notes tab, or drop or paste them into the page. Open them with your computer's own app, or save a copy.
- **Notes from a link** now reads YouTube videos from their captions. Teams, Zoom and Meet recordings sit behind a sign-in, so download them and use Transcribe a recording.
- Notes saved as `.docx` reopen exactly as you left them, voice notes, attachments and boxes included. In Word, they show as text: the voice note's transcript, each attachment's name, and the boxes from top to bottom. If the file is changed in Word, Work opens Word's version.
- Send to Present includes the text of write-anywhere boxes and voice note transcripts.
- Fixed: the hint on an empty line kept showing the Document text after switching to Notes.

## 0.2.25: Google Sheets formulas in Plot

- **Google Sheets files open without errors.** Formulas Google Sheets writes in a special wrapped form (GOOGLEFINANCE, ARRAYFORMULA, QUERY, SPLIT and other Google-only functions) now open as the real formula. Until live data arrives, or when you're offline, cells show the value saved in the file instead of an error.
- **GOOGLEFINANCE works**: current price and other attributes (`"price"`, `"change"`, `"changepct"`, `"high52"`, `"name"`, `"currency"`…) for tickers like `NASDAQ:GOOG`, `NSE:INFY` or `CURRENCY:USDINR`, and price history with a start date, end date or number of days, daily or weekly. Prices refresh every minute while the sheet is open.
- **IMPORTRANGE** reads from another Google Sheet through your Google Drive sign-in. **IMPORTDATA**, **IMPORTHTML**, **IMPORTXML** and **IMPORTFEED** read files, tables, lists and feeds from the web. **GOOGLETRANSLATE** and **DETECTLANGUAGE** work too.
- **Every Google Sheets function, built in.** Plot now has over 500 functions you can type in any cell, from `+` and `SUM` up: math, text, dates, lookup, statistics and distributions, finance and bonds, engineering, database functions, `REGEXMATCH`/`REGEXEXTRACT`/`REGEXREPLACE`, `SPLIT`, `JOIN`, `FILTER`, `SORT`, `SORTN`, `UNIQUE`, `QUERY`, `SEQUENCE`, `LET`, `LAMBDA`, `MAP`, `REDUCE`, `BYROW`, `XLOOKUP` and more. Formulas → Functions → **All functions…** lists them.
- **Array formulas spill.** A formula that returns several values (like `=A2:A10*2`, `=ARRAYFORMULA(…)`, `=FILTER(…)` or `=SPLIT(…)`) fills the cells below and to the right. If something is in the way, the cell shows `#REF!`; hover an error to see why.
- Saving as .xlsx keeps Google-only formulas in the form Google Sheets reads back, so files go back and forth without losing them.

## 0.2.24: Save notes as PDF

- **Save as PDF** is now on Write's **Notes** tab and in the **/** menu, next to Send to Present. It's still under **File > Export** too.
- PDFs come out on clean white pages. Before, the page margins came out grey in every app, and the cursor showed in Write.
- If a PDF can't be saved, Write now says why. Before, nothing happened. The most common cause on Windows is that the same PDF is still open in a viewer, so close it and try again, or pick another name.

## 0.2.21: More Spotfire functions in Plot

- **Statistics**: `valueformax([Vth], [Wafer])` and `valueformin` give one column's value on the row where another is largest or smallest. Also `weightedaverage([Weight], [Value])`, `uniqueconcatenate`, `outliers`, `pctoutliers`, `covariance`, `correlation`, and the `mostcommon` and `countbig` names. All of them work per group with OVER.
- **OVER**: `LastPeriods(3, [Date])` for moving windows, plus `PreviousPeriod`, `NextPeriod` and `All`.
- **Shortcuts**: `pctoftotal([Qty])` (percent of the total, or of each group's total with OVER) and `pctdiff([Qty])` (percent change from the row before).
- **Binning**: `binbyevenintervals`, `binbyevendistribution`, `binbyspecificlimits`, `autobinnumeric` and `binbydatetime([Date], "Year.Quarter.Month", 2)`. Each row gets the start of its bin, so bins sort and plot in order.
- **Dates and time spans**: `datetrunc`, `dayofmonth`, `yearandweek`, `fiscalyear`, `fiscalquarter` and `fiscalmonth` (with the month your fiscal year starts in), `toepochseconds` and `fromepochseconds`. `datediff(from, to)` gives a time span, which you can read with `totaldays`, `totalhours`, `days`, `hours`, `minutes` and `seconds`, or build with `timespan(…)`.
- **Conversion**: `parsedate([Text], "dd/MM/yyyy")` and `parsedatetime` read dates written in any layout. `parsereal` and `parseinteger` read numbers with thousands separators or a decimal comma, and `boolean` reads yes/no and true/false.

## 0.2.20: Right-click menus for cells, rows, columns and sheets

- Right-click a cell, a row number or a column letter in Plot to **Cut**, **Copy**, **Insert row above**, **Insert column left**, **Delete row** or **Delete column**, or clear contents or formats. Right-clicking a row number or column letter selects the whole row or column first. Undo (Ctrl+Z) puts deleted rows and columns back.
- Right-click a sheet tab in Plot for **Rename**, **Duplicate**, **Move left**, **Move right** and **Delete**. Before, you got a small dialog where Delete was easy to miss.
- **Delete sheet** is also on the Home tab (Cells) and the Insert tab (Sheets). A sheet with data asks first, and Undo (Ctrl+Z) brings it back.

## 0.2.19: Spotfire-style visualization settings in Plot

- Every visualization in Plot's **Analyze** workspace has a full **Properties** panel (Alt+Enter, the gear on the plot, or **Properties** on the ribbon) with tabs for General, Data, X axis, Y axis, Colors, Markers, Labels, Legend, Trellis, Line connection, Lines & curves and Tooltip. Changes show up as you make them.
- **Trellis** splits a plot into small panels, one per category of a column, or into a grid of rows and columns. All panels share the same axes, and you can mark points in any panel.
- **Markers**: pick a shape (circle, square, diamond, triangles, plus, cross), a size, size by a column, shape by a column, opacity, a fixed color, and jitter for points that sit on top of each other.
- **Line connection** joins a scatter plot's points with lines, one line per category of the "connect by" column, in the order of any column.
- **Axes**: your own title, a fixed range, log scale, reverse, and gridlines or tick labels on or off.
- **Labels** on points (marked or all, from any column) and values on bars, histograms and pie slices. **Legend** on the right or at the bottom, or hidden. **Reference lines** at a value, the average or the median. Choose which columns the **tooltip** shows.
- **Filters for one visualization**: limit a plot with a formula, give it its own column filters, or have it ignore the filters panel, while the other plots keep the page filters. Right-click a filter to move it onto the selected plot.
- **Ctrl+D** copies the selected visualization onto a new page right after the current one, with the Properties panel open, so you can switch it to a scatter plot or change anything without touching the original.
- **Right-click menus** on plots (change type, properties, trellis, color by, markers, connect by, fit curve, marking, copy as picture, export), on the page, on page tabs, on columns, on filters and on the details table.
- Plot lines, axis lines, curve fits and box-plot whiskers are a little thicker, so charts read more easily.
- **Keyboard shortcuts** like the ones analysts already know: Ctrl+A mark all, Ctrl+E unmark, Ctrl+I invert, Ctrl+M filter to marked, Ctrl+Shift+M filter out, Ctrl+R reset filters, Ctrl+N new page, Ctrl+Shift+D duplicate page, Ctrl+Tab next page, Ctrl+2 to Ctrl+9 new visualizations, Ctrl+C copy marked rows and more. Press **F1** (or **Shortcuts** on the ribbon) for the full list.

## 0.2.17: Spotfire-style functions in Plot

- Calculated columns and filter formulas in Plot's Analysis tab now cover the functions you'd use in Spotfire. Names aren't case-sensitive, so a formula like `StdDev([Vth]) OVER ([Lot])` works as written. The calculated column window lists them all by category.
- **Sigma and statistics**: `sigma` (also `stddev`), `var`, `stderr`, `median`, `percentile`, `p10`, `p90`, `q1`, `q3`, `iqr`, the box plot fences `lif`, `uif`, `lav`, `uav`, `lof`, `uof`, `l95` / `u95`, `uniquecount`, `mode`, `first`, `last` and more. `ucl([Vth], 3)` and `lcl([Vth], 3)` give the mean plus or minus 3 sigma, and `zscore([Vth])` says how many sigmas each row is from the mean.
- **Normal distribution**: `normsinv(p)` turns a probability into sigma (`normsinv(0.99865)` is 3), and `norminv`, `normsdist` and `normdist` work like their spreadsheet namesakes.
- **OVER**: work out any statistic per group (`avg([Vth]) OVER [Lot]`, `OVER ([Lot], [Wafer])`), as a running total (`sum([Qty]) OVER AllPrevious([Date])`, `AllNext`), or from the previous or next value (`OVER Previous([Date])`, `Next`), combined with `Intersect`.
- **Ranking**: `rank`, `denserank` and `rankreal`, ascending or `"desc"`, optionally within groups.
- **Text**: `split([Tag], "_", 2)` keeps the second part of a tag (`-1` keeps the last part). Also `find`, `substitute`, `replace`, `rxreplace`, `rxextract`, `left`, `right`, `mid`, `len`, `upper`, `lower`, `trim`, `repeat`, `concatenate` and `&` to join text.
- **Logic**: `case when … then … else … end`, `[x] in ("a", "b")`, `[x] is null` / `is not null` and `sn`.
- **Dates**: `year`, `quarter`, `month`, `week`, `day`, `dayofweek`, `dayofyear`, `hour`, `minute`, `second`, `datepart`, `dateadd`, `datediff`, `date`, `datetime`, `today` and `datetimenow`. A formula that gives a date makes a date column.
- **Math and conversion**: `log(x, base)`, `power`, `divint`, `ceiling`, `cot`, `degrees`, `radians`, `pi`, `rand`, `randbetween`, `integer`, `real` and `string`.
- Fixed: column lists that open from a plot's axis picker, or any other drop-down near the bottom of the window, now open upward when there is no room below and scroll, so every column can be picked.

## 0.2.16: Google Drive sign-in fix

- **Connect Google Drive** works with one click: Work's built-in Google sign-in now carries the right app ID, so you just pick your Google account instead of seeing "OAuth client was not found".

## 0.2.15: Notes in Write

- Write has a **Notes mode** for meetings and quick notes. Switch with **Document / Notes** at the top right of the ribbon, or start fresh with **New > Notes** on the start screen. Notes open with a title and today's date, and the new **Notes** tab holds everything below.
- Every new line is a bullet. **Tab** indents and **Shift+Tab** outdents. Press Enter on an empty bullet for a plain line.
- **Checklists** you can tick off, **time stamps**, tables, pictures and dividers. Type **/** anywhere for a quick-insert menu.
- **Draw** with a mouse, finger or stylus: pen, highlighter and eraser, six colours, three sizes, and pen pressure. Double-click a picture to draw on it.
- **Paper**: plain, lined, grid or dots, in white, sand, mint, sky, lavender or rose.
- With your connected AI: **Summarize** (key points, decisions and action items), **Action items** as a checklist, **Tidy up** rough notes, and **Link to notes**, which reads a public web page and turns it into notes or a summary. Video and meeting recordings can't be read from a link yet.
- **Plot** makes a chart from a typed instruction, such as "bar chart of the budget table above" or "y = sin(x) from 0 to 10", drawn with Plot's own charts.
- **AI Picture** makes a picture from a typed instruction. With an OpenAI or Gemini key saved it uses their image model; with Claude or a ChatGPT sign-in, the AI draws it as an illustration.
- In the Claude app on the start screen, **Notes** makes notes from your request or attached files, and any document it makes can also open as notes.
- **Send to Present** is on the Notes tab and in the / menu too, and checklists keep their ☐ / ☑ boxes on the slides.
- Notes save as normal .docx files: checklists become ☐ / ☑ lines, and the file reopens in Notes mode.

## 0.2.14: Turn Write documents into presentations

- **Send to Present** on Write's Home and Claude tabs turns your document into a new presentation. Headings, paragraphs, bullet points, quotes, pictures and tables all come along.
- With an AI connected (Claude, ChatGPT, OpenAI or Gemini), it designs the deck: it picks a layout for each slide, writes short bullets, puts the detail in speaker notes, and places each picture and table on the slide where it belongs. It looks at your pictures, so they land next to the right text. Tell it anything extra, like "about 8 slides for a class".
- Without an AI, **Simple** makes one slide per heading: paragraphs and lists become bullets, pictures sit beside the text, tables get their own slide, and long sections carry on over the next slide.
- Pick a template (Paper, Slate, Midnight, Sunrise, Forest or Berry), and select part of the document first to send only that part. The presentation opens in Present, ready to edit, show or save as .pptx.

## 0.2.13: Send plots to Present

- **Send to Present** on Plot's Analyze tab puts your plots on a slide. A list shows every plot in the analysis, page by page, so tick the ones you want and untick the rest.
- Pick a Present template (Paper, Slate, Midnight, Sunrise, Forest or Berry) and give the slide a title. The plots are arranged in a grid, each with its name above it.
- Tick **Add a table of rows** to put data on the same slide. Choose the columns, take filtered, marked or all rows, and narrow them with a formula such as `[Year] == 2021 or [Year] == 2023`.
- The slide opens as a new presentation in Present, ready to edit, show or save. Saving as .pptx keeps the table as a real table.

## 0.2.12: Combine tables in any sheet

- **Add Rows** on the Data tab stacks another table under the one you're in. Take it from another sheet in the workbook or from a file (Excel, OpenDocument, CSV or TSV). Columns are matched by name, and you can map the rest yourself or leave them out. Optionally add a column that says where each row came from.
- **Add Columns** joins another table on one or more key columns, with a left, inner, right or full join, and lets you pick which of its columns to bring in. Keys are compared as written, so IDs like 007 stay as they are.
- Click anywhere inside your table first: Work finds its edges, with the column names in the first row. The result goes under or next to the table, or on a new sheet. Formulas and formats in your table are kept, formula columns carry on into new rows, and Undo puts everything back.
- **Connect Google Drive** with one click: Work now comes with its own Google sign-in, so you just pick your Google account. No setup in Options.

## 0.2.11: Upload LaTeX projects as a .zip

- **Upload LaTeX (.zip)** on the Home and New screens opens a zipped LaTeX project, like the ones online LaTeX editors download. Work unpacks it next to the .zip, finds the main `.tex` file and compiles it.
- The LaTeX file list is now a **Files** pop-up instead of a pane that always took space. Open it from the Files tab beside File, Home and View, or from the Files button in the bottom-left corner. It shows how many files and folders the project has, and **Upload** adds files or a .zip. Pin it if you prefer a pane.
- Drop a .zip onto the file list to add everything inside it to the project.

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
