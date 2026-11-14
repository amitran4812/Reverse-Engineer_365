# What's new in Work

Each version of Work and what it adds or fixes. The newest version is at the top. Download any version from [Releases](https://github.com/amitran4812/Reverse-Engineer_365/releases). From 0.2.4 on, Work updates itself.

## 0.2.44: Write on PDFs with a pen or your finger

- **A new Draw tab in Read** for writing and drawing straight on a PDF with a stylus, a touch screen or a mouse. Pick the **Pen** or the see-through **Highlighter**, a colour and a thickness, and write.
- **Pen pressure.** Press harder for a thicker line and lighter for a thinner one, like real ink. Turn it off with **Pen pressure** if you want an even line.
- **Pen and finger work together.** Until you use a pen, your finger writes. Once Read sees a pen, the pen writes and your finger scrolls the pages, and a hand resting on the screen while you write is ignored. **Draw with Touch** switches finger writing back on or off at any time.
- **A better eraser.** Drag the eraser over your writing to take away whole strokes, or choose **Just what it touches** to rub out only the part under it, in three sizes. The eraser end (or eraser button) of a pen erases too. Each drag is one step for **Undo**, which is also on the Draw tab for when there's no keyboard.
- **Add a page anywhere to write on.** Point between two pages (or tap the **+** there) and pick a blank, lined, grid or dotted page. It comes in the same size as the pages around it. **Draw › Add Page** and **Organize › Blank page** add one after the page you are on.
- Your writing is saved inside the PDF as standard ink annotations, so other PDF readers show it too, and Read keeps the pressure and highlighter look when you open the file again.

## 0.2.43: Cite the papers in your Project from LaTeX

- **Every paper in a Project can be cited from the LaTeX file you are writing.** When your LaTeX project is in a Project, each PDF in that Project is looked up once (by its DOI, arXiv id or title) and listed under **Insert › Cite** (Ctrl+Shift+C). Pick a paper and it is cited at the cursor and added to your .bib in the same step. There is no need to look it up or copy a BibTeX entry.
- **Suggestions after `\cite{`** now include the Project's papers and My Library, along with what is already in the .bib. Picking one that isn't in the .bib adds it there for you.
- **Quick search like a reference manager:** type part of a title, author, year or key, then press Enter to cite. Tick several papers (or press Ctrl+Enter on each) to cite them together in one `\cite{a, b}`. With the cursor inside an existing `\cite{…}`, new keys are added to it.
- **The picker shows what you have already cited** (*Cited 2×*, *In .bib*). It flags papers whose details need checking, and the pencil button lets you fix a paper's details once for the whole Project. **Add all to .bib** adds every paper at once.
- **Hover a citation key** to see the paper's title, authors and year, with a button that opens its PDF.
- The citation command follows your document (`\citep` with natbib, `\parencite` with biblatex), and you can change it in the picker. The same paper is never added to the .bib twice. A different paper whose key is already taken gets a letter, like `smith2020a`. If the document has no bibliography yet, one is added before `\end{document}`.
- Compiled PDFs and figures inside the LaTeX folder are not listed as papers.
## 0.2.42: Track changes, comments, history and Git for LaTeX

### Review your LaTeX like a pro

- **Track changes.** Turn on Review › Track Changes and every edit shows as a suggestion: new text underlined in green, removed text struck through in red. Hover a change to accept or reject it, or use Accept all and Reject all. Changes made by the AI helper while tracking is on are suggestions too.
- **Comments.** Select some text and press Ctrl+Alt+M (or Review › New Comment). Comments sit in the Review pane beside the editor with replies, Resolve and Delete, and follow their text as you edit. Tracked changes and comments are saved with the project in `.work/review.json`, so they travel with Git and copies of the folder.
- **Check Writing.** The AI proofreads the prose (never the commands or maths) and underlines spelling, grammar and style problems, each with a one-click Fix. Select a paragraph to check just that part.
- **Rewrite with AI.** The LaTeX Helper tab has Shorter, Expand, Paraphrase, More academic, Simpler, Translate and Write an abstract, all keeping your commands, citations and maths as they are.

### Never lose a version

- **History.** Every save keeps a version of the whole project. Review › History shows each one with what changed, word by word, side by side with the version before or with the project now. Restore one file or the whole version, or download any version as a .zip. Restoring keeps the current state first, so it can be undone.
- **Named versions.** Review › Name Version keeps the project as it is under a name like "Sent to supervisor".

### Sync with GitHub or GitLab

- **Git Sync.** Set up Git for a project, connect it to a repository on GitHub, GitLab or any Git host, then Commit and Sync to send your work and bring in your co-authors' changes. No Git install is needed. Access tokens are kept encrypted on your computer. If both sides changed the same lines, nothing is overwritten and Work says which files clash.
- **New project from Git.** Files › Upload › New project from Git downloads a repository and opens it.

### Write faster

- **Visual editor.** Switch between Code and Visual above the editor (Ctrl+Shift+E). Visual shows headings as headings, bold and italic as they look, equations and inline maths drawn, pictures under their `\includegraphics`, bullets for lists, the title block, and citations and references as small tags. The preamble folds into one line. Whatever the cursor is in turns back into LaTeX so it can be edited.
- **Table builder.** Insert › Table › Table builder gives a grid to fill in: add and delete rows and columns, set each column's alignment, choose clean lines (booktabs), all borders or none, and paste cells straight from a spreadsheet. With the cursor in an existing table, Edit this table opens it in the grid and keeps its column widths and indentation.
- **Figure builder.** Insert › Figure › Figure builder shows the project's pictures as thumbnails. Pick one, or several to place side by side with their own captions, then set the width, caption, label and placement.
- The builders add any package they need (booktabs, subcaption, float) to the preamble for you.

### Compiling

- **No time limit.** Compiles run as long as they need, with the time shown on the button. Set a limit under the Recompile menu › Time limit if you want one.
- Fixed "Couldn't show the PDF" after recompiling a project.

## 0.2.40: Pictures and charts in Plot, visual decks in Present

### Plot shows the pictures and charts in your workbooks

- **Pictures and charts in .xlsx files now show in Plot.** Before, Plot opened only the cells, so photos, logos and charts added in Excel, Google Sheets, WPS or LibreOffice were missing. Now they sit over the cells where they were placed, at their own size. Charts (column, bar, line, area, scatter, pie and doughnut) are drawn from the workbook's data, including files saved without a chart preview.
- **Pictures placed in a cell** (Excel's *Place in Cell* and WPS cell pictures) show inside their cell.
- **Row heights come across**, so tall rows made for pictures keep their height. Drag the bottom edge of a row number to change a row's height.
- **Move, resize and delete pictures:** click one to select it, drag to move it, drag the corner to resize it (Shift for free resizing), and press Delete to remove it. Right-click for Bring to Front and Send to Back. Pictures move with their cells when you insert or delete rows and columns.
- **Insert › Picture** adds a picture from your computer, and pasting an image with Ctrl+V puts it at the selected cell.
- **Saving keeps them.** Pictures save back into the .xlsx where they were. Charts save as pictures of the chart, so they look the same in every app.
- A workbook that is large only because of its pictures now opens in the sheet instead of the Analysis workspace.

### Saving PowerPoint and Word files keeps more

- **Present: tables in a saved .pptx keep their text size, colours, bold, column widths and row heights.** Before, every table came out in small black text with equal columns.
- **Present: sub-points stay indented** when a deck is saved as .pptx, instead of all becoming top-level bullets.
- **Write: table cell colours stay.** Shaded cells in a .docx (header rows, highlighted cells) keep their fill when opened and saved.

### Send to Present makes visual decks

- **Send to Present makes visual decks, not just text.** Tables of numbers in Write and LaTeX documents now also become charts (bars, or lines for years and months), drawn in the template's own colours. With AI, Claude also charts figures it finds in the text and can put a chart beside the bullets.
- **Free photos from the web.** The title slide and some other slides get a photo that fits their topic, from Openverse (or Wikimedia Commons), openly licensed for reuse. Each photo is credited in the corner of the slide and in the speaker notes. Turn charts or photos off under "Make it visual" in the Send to Present dialog.
- **Plot: one slide for each plot.** Send to Present from Analyze can now put each plot on a slide of its own, titled with the plot's name, instead of all plots on one slide.

## 0.2.39: Projects, more fonts, PowerPoint saving and files from other apps

### Files from other apps open with their pictures and formatting

- **Slides from LibreOffice Impress and Google Slides open the way they look.** OpenDocument presentations (.odp) used to bring in only the text. Now they open with their slide size, master artwork and backgrounds (colors, gradients, pictures), pictures (with crops), shapes and lines, rotated and grouped shapes, tables, charts, bullets and numbering, fonts, sizes and colors, and speaker notes. New slides you add use the deck's own master.
- **.pptx files from Google Slides, LibreOffice and other apps** keep cropped pictures, shapes filled with a picture, and text centered the way LibreOffice saves it. Pictures saved without a file extension, or under the wrong one, now show.
- **Documents from LibreOffice Writer and Google Docs keep their look.** .odt files now open with pictures, fonts, sizes, colors, highlight, alignment, indents, headings, bullet and numbered lists, tables, links, footnotes and page breaks (before, only the text came across). .docx files now keep text colors, fonts, sizes, highlight, underline, paragraph alignment and picture sizes.
- **Rich Text (.rtf) opens in Write**, from WordPad, TextEdit, Word or LibreOffice, with its formatting, lists, tables and pictures.
- **More file types open:** PowerPoint shows and templates (.ppsx, .potx, .pptm), Word templates and macro documents (.dotx, .docm), Excel binary and macro templates (.xlsb, .xltm), Apple Numbers (.numbers), and the flat and template OpenDocument types (.fodp, .fodt, .fods, .otp, .ott, .ots). They open as a copy you save as .pptx, .docx or .xlsx.
- Keynote (.key) and Pages (.pages) files explain how to export them: in Keynote choose **File › Export To › PowerPoint**, in Pages **File › Export To › Word**, then open that file here.

### More fonts everywhere

- **60 fonts included with Work**, so they look the same on every computer and work offline: sans serif (Inter, Roboto, Open Sans, Lato, Montserrat, Poppins and more), serif (Merriweather, Lora, Playfair Display, EB Garamond and more), monospace (Fira Code, JetBrains Mono, Source Code Pro and more), display, handwriting, and Hindi, Bengali, Tamil, Arabic and Hebrew faces.
- **Your computer's own fonts** are listed too, under **On this computer**. Type any font name in the search box and press Enter to use it.
- **One font picker everywhere**: search, sections for recently used, included and installed fonts, each name shown in its own face. It's in Write and Notes, in Present (Home › Font, new), in Plot (Home › Font, new, with a font size) and in the LaTeX editor (View › Editor font, monospace fonts).
- Read's **Fill & Sign** offers ten included handwriting fonts for typed signatures, plus the handwriting fonts your computer has.
- Documents that ask for Calibri, Cambria, Arial, Helvetica, Times New Roman or Courier New keep their layout on computers without those fonts: a free font with the same letter widths stands in.
- Fonts are kept when you save: Word files, PowerPoint files and Plot's Excel files (fonts and sizes of cells, also when you open one).

### Projects, so Claude knows the whole piece of work

- **Projects** keep the files for one piece of work together, and Claude reads all of them. Open **Projects** on the start screen, choose **New project**, give it a name and, if you like, a line about what it is for (for example "Literature review for chapter 3; review/ is my LaTeX draft"). Claude reads that first.
- **Put anything in it**: research papers (PDF), Word, Excel and PowerPoint files, OpenDocument files, Present decks, LaTeX sources and .bib files, Markdown and text, code, CSV and pictures. **Add files** (or drag them onto the list) copies them into the project. **Add folder** links a folder such as a LaTeX project, so Claude always reads its files as they are now.
- **Add files you made earlier, any time**: in Write, Plot, Present and Read use **File › Add to project** (a LaTeX project adds its whole folder), or hover a file under **Recent** on the start screen and click the project button. The file stays where it is and Claude reads its latest saved version.
- **Chat with the project**: the project page has its own Claude chat with one-click **What's in this project**, **Compare the papers**, **Literature review** (opens in Write) and **Make a deck** (opens in Present). Answers name the files they come from.
- **Claude in every app can use a project too**: click the folder button at the top of the Claude pane and pick one. A file that belongs to a project opens with Claude already reading that project; click the × on the "Project" chip to stop.
- PDFs are read once when you add them, so later questions are quick, and the project is cached between messages so follow-up questions cost less. Claude reads up to about 150k tokens of text from a project (a dozen or more full papers); long files share the room fairly so none is left out. With a 1M-token model you can raise it to about 600k tokens in the project's options.

### Download a LaTeX project as a .zip

- **Download .zip** in Write's LaTeX mode saves the whole project as one .zip file: every .tex file, the .bib files, pictures, styles and any other files in the project's folders, plus the compiled PDF. Find it on the **Home** tab, in the preview's toolbar, in the **Files** pop-up (and its **Upload** menu), and under **File › Export › Project as a .zip**.
- Text you haven't saved yet goes into the .zip as it is in the editor, without saving the files on disk.
- Build leftovers (.aux, .log, .synctex and the like) and hidden files stay out. The .zip opens again in Work with **Upload › New project from a .zip**, and in online LaTeX editors.
- **Download PDF** works again: it saves the compiled PDF where you choose.

### Present saves PowerPoint files

- **Present now saves .pptx.** Ctrl+S and **File › Save As** write a PowerPoint file, so anyone can open your deck in PowerPoint, Keynote, Google Slides or LibreOffice, on Windows, Mac or Linux. There is no Work-only file type any more: Write saves .docx, Plot saves .xlsx or .csv, and Present saves .pptx.
- A deck Present saved reopens in Present exactly as you left it, themes and template artwork included. If someone edits the slides in PowerPoint, Present opens their version instead.
- A .pptx made in another app still opens as a copy, so saving never overwrites the original by surprise; the first save asks where to put it.
- Older **.reaslides** files still open. Save them once and they become .pptx.
- In Explorer, **New › Present presentation** now makes a .pptx.

### Independent copies and a cleaner Analyze page

- **Ctrl+D copies have their own marking.** Rows you mark in a copy no longer light up in the original (and the other way round), so a copy you change to a scatter plot, or any other type, works on its own.
- **Pick a marking for any visualization.** In **Properties › Data › Marking**, choose **Marking** to link a visualization with the others again, pick another marking such as **Marking (2)**, or make a **New marking**. Visualizations with the same marking highlight the same rows, as in Spotfire. The status bar, details table, Clear Marking and Filter to Marked follow the selected visualization's marking.
- The small chart icon on a visualization's title bar now changes when you change its type.
- **A cleaner Analyze page that fits on one screen.** Analyze now opens with the details table closed, so the plots fill the window without scrolling. Open the table with **Details** in the ribbon's **Show** group or the button on the left rail; your choice is saved with the analysis. Analyses saved before this version also open with the table closed.
- Each plot's zoom, pan and settings buttons now show only on the selected plot or when you point at it, so a page of plots looks calmer.
- The ribbon's scrollbar on small screens is now thin and no longer covers the group names.

### Features from the apps you know

- **Plot: freeze panes, filters and conditional formatting.** **View › Freeze Panes** keeps the top row, first column or everything above and left of the selected cell in place while you scroll. **Data › Filter** (Ctrl+Shift+L) puts a drop-down on each header: tick the values to show, search them, or sort. **Home › Highlight** colors cells by rule: greater than, less than, between, equal to, text that contains, duplicates, top or bottom N, above or below average, data bars and a red-to-green color scale, with **Manage rules** to remove them. All three are saved in the .xlsx, so other spreadsheet apps show them too.
- **Write: Navigation pane, table of contents and comments.** **View › Navigation Pane** lists your headings; click one to jump there. **Insert › Contents** adds a table of contents that keeps itself up to date. Select text and choose **Review › New Comment** (Ctrl+Alt+M) to leave a note; the Comments pane lets you edit, resolve, reopen and delete them, and Previous and Next step through them. Comments are saved as real Word comments, and the table of contents comes back when you reopen the file.
- **Present: transitions, align and distribute.** The new **Transitions** tab gives each slide a Fade, Push, Wipe, Cover, Zoom or Split entrance, at fast, medium or slow speed, with **Apply to All** and **Preview**. They play in the slide show and are saved in the .pptx. Shift+click to pick several boxes, drag them together, and use **Home › Align** to line them up or spread them out evenly.
- **Cite: My Library.** Every reference you copy or insert is kept in **My Library** (in the Cite dialog), and **Save** keeps one without using it. Search it, tag papers, pick one to use again, add a whole .bib or .ris file from another reference manager, and copy or export a bibliography of everything (or just the ones you tick) in any of the eight styles.
- **Notes: toggles, callouts and templates.** Type **/** and choose **Toggle** for a line that folds away what's under it, or a callout (Info, Tip, Warning, Idea; click its badge to switch). **Notes › Templates** starts a page for meeting notes, lecture notes, Cornell notes, a project plan or a daily journal.
- **Read: read aloud, and highlights to Notes.** **View › Read Aloud** reads the PDF out loud from the current page with your computer's voices (Esc stops). **Comment › Highlights to Notes** opens your highlights, underlines and comments as notes in Write, page by page, with the highlighted text quoted and your comment under it.
- **LaTeX: word count and symbols.** **Home › Word Count** counts the words in the text, headings and captions, plus equations, for this file and the whole project. **Insert › Symbols** has Greek letters, operators, relations, arrows and more; outside maths they go in wrapped in $ … $.

### Recent files in every app

- **File › Recent in every app**, with a filter for each app and for Notes and LaTeX, a search box, and pins to keep a file at the top. The clock button in each window's title bar shows the same list.
- **Files from Google Drive or OneDrive reopen with one click**, from the copy Work keeps on your computer, without downloading them again. If the file changed on the drive, Work fetches the newer version in the background (and asks first if you have unsaved changes).

### Zoom in Present

- **Zoom in and out on the slide you're editing.** Use **View › Zoom** (Zoom In, Zoom Out, 100%, Fit to Window), the slider at the bottom right, Ctrl+= and Ctrl+-, or Ctrl+mouse wheel (or pinch) to zoom around the pointer. Ctrl+0 fits the slide to the window again. Moving and resizing boxes works at any zoom.

## 0.2.38: Excel files from other programs open

- **Workbooks that showed "Cannot read properties of undefined (reading 'sheets')" now open.** Many programs besides Excel (bank and accounting exports, reporting tools, apps built on Microsoft's .NET library) save .xlsx files in a slightly different way. Plot now reads them, with their formatting.
- Files saved in Excel's **Strict Open XML** format open too.
- A file that ends in .xlsx but is really an older .xls, a web page table or CSV opens instead of failing.
- The same files work in **Analyze** (big files), **Add rows / Add columns**, and when you attach them to Claude.
- A password-protected workbook now says so: remove the password in Excel and open it again.

## 0.2.37: Light, dark or system theme

- **Dark mode for night work.** Pick **Light**, **Dark** or **System default** with the sun or moon button at the top right of any window, or under **File › Options › Appearance** (Home has it in **Options** too). The choice applies to every open window straight away and is remembered.
- **System default** follows your computer's light or dark setting (on Windows: Settings › Personalization › Colors), and switches when that setting changes.
- In dark mode the ribbon, panes, dialogs and the Claude pane turn dark, and so do Write's pages, Notes paper (including its tints), Plot's grid, Plot's charts in Analyze, the LaTeX editor and Read's panes around the PDF.
- Some things keep their own colors on purpose: slides in Present, PDF pages in Read and the LaTeX preview (Read's own **Night** button still darkens a PDF's pages), and everything you print or export (PDF, Word, PowerPoint, pictures of charts) stays on white paper.
- Text you colored black, and cells or highlights with a light fill, stay readable on the dark page.

## 0.2.36: Read, a PDF reader and editor

- **Read** is a new app for PDFs. Open a PDF from the start screen (**Open a PDF**), **File > Open**, or right-click a PDF in Explorer and choose **Open in Read**. Read never takes over as your default PDF app unless there is none.
- **Read comfortably**: page thumbnails, bookmarks, find (Ctrl+F) with every match marked, clickable links, fit width or fit page, zoom with Ctrl and the mouse wheel, rotate the view, **Night** pages for reading in the dark, and full-screen **Read Mode**.
- **Mark it up**: select text and a small bar offers Highlight, Underline, Strikethrough, a comment, Copy and Ask Claude. Add sticky notes, text boxes, pen drawings, rectangles, ovals, lines and arrows in any colour and thickness. Click any mark to recolour it, comment on it, move it, resize it or delete it. The **Comments** panel lists everything by page.
- **Fill & Sign**: type, draw or upload your signature or initials (saved for next time, encrypted on this computer), then click where it goes. Add text, today's date, check marks, crosses and pictures.
- **Organize pages**: rotate, delete, move, extract to a new PDF, add a blank page, insert pages from other PDFs, or combine several PDFs into one.
- **Convert**: open the PDF as a Write document (headings, paragraphs, lists and tables kept), as notes, as a Plot workbook (one sheet per page, tables split into columns), or as a Present deck (one slide per page, with the page's text in the speaker notes). Or save a page as a picture, or all the text as a .txt file.
- **Claude** reads the PDF with you: summarize it, pull out key points and numbers with page references, explain a passage in simple words, or quiz you on it.
- Your marks are saved as standard PDF comments, so other PDF readers show them, and Read can edit marks made in other readers. Signatures, dates, check marks and pictures become part of the page when you save.
- Not yet: changing the PDF's own text and pictures, filling in form fields, saving changes into password-protected PDFs, and reading scanned pages (OCR). These are next.

## 0.2.35: PowerPoint files open the way they look

- **Opening a .pptx keeps its design.** Present now reads the whole file instead of just its text: the slide size, the template's backgrounds and artwork from the master and layouts, theme colours and fonts, and every slide, the first one included.
- Text keeps its fonts, sizes, colours, bold and italic, alignment, line and paragraph spacing, and the deck's own bullets and numbering at each level.
- Pictures (with their crops), shapes and their outlines, lines and arrows, grouped objects, tables with their cell colours and borders, charts (column, bar, line, area, pie and doughnut) and SmartArt come across in place.
- Template artwork stays behind the slide content, so it can't be moved by accident. **New Slide** and **Layout** use the deck's own layouts.
- Formatting a whole text box from the ribbon still works on opened slides, and saving back to `.pptx` keeps the slide size, backgrounds and fonts.

## 0.2.34: Send a LaTeX paper to Present, and decks as long as they need to be

- **Send to Present in LaTeX mode**: on the Home tab (and the LaTeX Helper tab), turn the whole project, or the part you selected, into a presentation. The title and authors open the deck; the abstract, sections, lists, theorems, figures, tables and display equations all come across. Files pulled in with `\input` and `\include` count too, figures are found through `\graphicspath` (PNG, JPG, SVG and PDF figures), and `\ref` turns into the right number.
- **Equations on slides**: the AI can give an important equation a slide of its own, drawn sharp and in the template's text colour (light on dark templates). Equations in Write documents get the same treatment.
- **No slide limit**: the AI now makes as many slides as the document needs, instead of aiming for 5-12. Type a number in the new **Number of slides** box, or ask for one in the notes box ("about 10 slides"), when you want a set length.
- The progress box counts the slides as the AI writes them.

## 0.2.33: Your own PowerPoint templates

- **Upload your own templates.** On Present's **Design** tab, **Upload Template** takes a PowerPoint template or presentation (.pptx, .potx, .pptm or .potm). Work keeps it, so it shows up next to Paper, Slate and the others from then on, in every Present window.
- **They show up in Send to Present too.** The template picker in Plot's and Write's **Send to Present** lists your uploaded templates, with an **Upload…** tile to add one right there. The slides it makes use that template.
- What comes across from the template: its background (a color or a picture), the pictures and colored boxes on the slide master such as a logo or a strip along the bottom, the title and text colors, and the title and body fonts. Placeholder positions and effects stay as Present lays them out.
- Saving as .pptx puts the template's background and pictures on the slide master, so the deck looks the same in PowerPoint. A saved presentation keeps its template's look even on a computer that doesn't have the template.
- To remove an uploaded template, point at it in the picker and click **×**, or pick it in Present and click **Remove Template**. Presentations already made with it aren't changed.
- Older .ppt files can't be read; open them in PowerPoint and save them as .pptx first.

## 0.2.31: Cite a paper in APA, MLA, IEEE, BibTeX and more

- **Cite a paper** from Home: pick or drop a PDF or Word file, or type its DOI, arXiv id, ISBN, link or title. Work finds the paper's DOI on its first pages and fetches the full reference from doi.org (Crossref and DataCite), arXiv or Open Library. Papers without an identifier are matched by title on Crossref, and you pick the right one.
- **Eight styles**: APA 7, MLA 9, Chicago (author-date), Harvard, IEEE, Vancouver, BibTeX and RIS (for Zotero, Mendeley and EndNote). Switch with one click; the style you used last is remembered.
- **One-click copy**: Copy reference keeps the italics when pasted into Word, Google Docs or Write. The in-text citation, like (LeCun et al., 2015) or [1], has its own Copy button.
- **Edit details** fixes anything the lookup got wrong, and the reference updates as you type. Offline, or with no match, the reference is built from the file's own title, author and date for you to check.
- **Write**: Cite on the Insert tab looks up the open document when it carries a DOI or arXiv id, and inserts the reference or the in-text citation at the cursor.
- **LaTeX**: Cite a paper on the Insert tab adds the BibTeX entry to the project's `.bib` file (or a new `references.bib`) and puts `\cite{key}` at the cursor.

## 0.2.27: More chart types and the rest of the analyst shortcuts in Plot

- New visualizations in Plot's **Analyze** tab: **Waterfall** (running total by category, with a total bar), **Combination** (bars for the first column, lines for the others, optionally on a right axis), **Treemap**, **Parallel coordinates** (one line per row across several number columns; drag on an axis to mark a range) and **KPI** tiles. Each can be marked by clicking, has a tooltip and is in the right-click "change type" grid.
- **Text area** for notes on a page (Ctrl+T).
- **Undo and redo** (Ctrl+Z, Ctrl+Y) for plots, pages and filters.
- **Paste data** (Ctrl+V): rows copied from a spreadsheet or a CSV, header first, open as the data table.
- New keys: Ctrl+4 waterfall, Ctrl+6 combination (two-axis line moves to Ctrl+Shift+5), Ctrl+Shift+2 treemap, Ctrl+Shift+4 parallel coordinates, Ctrl+Shift+7 KPI, Ctrl+W close.
- Formula boxes get line-editing keys: Ctrl+D duplicate line, Ctrl+L delete line, Ctrl+T swap with the line above, Ctrl+U / Ctrl+Shift+U lower / upper case, Ctrl+Shift+Delete delete to the end of the line, Tab / Shift+Tab indent.
- The shortcuts list (F1) shows all of these.

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
