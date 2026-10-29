// Suggestions for Write's LaTeX editor: commands, environments, packages and
// classes, plus project-aware ones (citation keys, labels, files) built from
// the project's sources. Snippet fields use CodeMirror's ${name} syntax.

import { snippet } from '@codemirror/autocomplete';
import { completionContext, openEnvironment } from '../../common/latex.js';

// [name, snippet after the backslash (defaults to the name), detail]
const COMMANDS = [
  ['section', 'section{${title}}', 'Section heading'],
  ['section*', 'section*{${title}}', 'Unnumbered section'],
  ['subsection', 'subsection{${title}}', 'Subsection heading'],
  ['subsubsection', 'subsubsection{${title}}', 'Sub-subsection heading'],
  ['chapter', 'chapter{${title}}', 'Chapter (report, book)'],
  ['paragraph', 'paragraph{${title}}', 'Run-in paragraph heading'],
  ['part', 'part{${title}}', 'Part'],
  ['label', 'label{${key}}', 'Name this spot for \\ref'],
  ['ref', 'ref{${key}}', 'Number of a label'],
  ['eqref', 'eqref{${key}}', 'Equation number in parentheses'],
  ['pageref', 'pageref{${key}}', 'Page of a label'],
  ['autoref', 'autoref{${key}}', 'Reference with its name (hyperref)'],
  ['cref', 'cref{${key}}', 'Clever reference (cleveref)'],
  ['cite', 'cite{${key}}', 'Citation'],
  ['citep', 'citep{${key}}', 'Parenthetical citation (natbib)'],
  ['citet', 'citet{${key}}', 'Textual citation (natbib)'],
  ['parencite', 'parencite{${key}}', 'Parenthetical citation (biblatex)'],
  ['textcite', 'textcite{${key}}', 'Textual citation (biblatex)'],
  ['autocite', 'autocite{${key}}', 'Citation (biblatex)'],
  ['nocite', 'nocite{${key}}', 'List without citing'],
  ['footnote', 'footnote{${text}}', 'Footnote'],
  ['textbf', 'textbf{${text}}', 'Bold'],
  ['textit', 'textit{${text}}', 'Italic'],
  ['emph', 'emph{${text}}', 'Emphasis'],
  ['underline', 'underline{${text}}', 'Underline'],
  ['texttt', 'texttt{${text}}', 'Monospace'],
  ['textsc', 'textsc{${text}}', 'Small caps'],
  ['textsf', 'textsf{${text}}', 'Sans serif'],
  ['textrm', 'textrm{${text}}', 'Roman'],
  ['textcolor', 'textcolor{${red}}{${text}}', 'Coloured text (xcolor)'],
  ['href', 'href{${https://}}{${text}}', 'Link (hyperref)'],
  ['url', 'url{${https://}}', 'URL'],
  ['usepackage', 'usepackage{${package}}', 'Load a package'],
  ['documentclass', 'documentclass{${article}}', 'Document class'],
  ['title', 'title{${title}}', 'Document title'],
  ['author', 'author{${name}}', 'Author'],
  ['date', 'date{${\\today}}', 'Date'],
  ['maketitle', null, 'Print the title block'],
  ['tableofcontents', null, 'Table of contents'],
  ['listoffigures', null, 'List of figures'],
  ['listoftables', null, 'List of tables'],
  ['newpage', null, 'Start a new page'],
  ['clearpage', null, 'New page, flush floats'],
  ['newline', null, 'Line break'],
  ['noindent', null, 'No paragraph indent'],
  ['centering', null, 'Center the current block'],
  ['today', null, 'Today’s date'],
  ['LaTeX', null, 'LaTeX logo'],
  ['item', 'item ${}', 'List item'],
  ['includegraphics', 'includegraphics[width=${0.8}\\linewidth]{${file}}', 'Insert an image (graphicx)'],
  ['caption', 'caption{${text}}', 'Caption for a figure or table'],
  ['input', 'input{${file}}', 'Include another .tex file'],
  ['include', 'include{${file}}', 'Include a chapter on a new page'],
  ['bibliography', 'bibliography{${references}}', 'Use a .bib file (BibTeX)'],
  ['bibliographystyle', 'bibliographystyle{${plain}}', 'BibTeX style'],
  ['addbibresource', 'addbibresource{${references.bib}}', 'Use a .bib file (biblatex)'],
  ['printbibliography', null, 'Print the bibliography (biblatex)'],
  ['newcommand', 'newcommand{\\${name}}{${definition}}', 'Define a command'],
  ['renewcommand', 'renewcommand{\\${name}}{${definition}}', 'Redefine a command'],
  ['hline', null, 'Table rule'],
  ['toprule', null, 'Top rule (booktabs)'],
  ['midrule', null, 'Middle rule (booktabs)'],
  ['bottomrule', null, 'Bottom rule (booktabs)'],
  ['multicolumn', 'multicolumn{${2}}{${c}}{${text}}', 'Cell spanning columns'],
  ['vspace', 'vspace{${1em}}', 'Vertical space'],
  ['hspace', 'hspace{${1em}}', 'Horizontal space'],
  ['begin', 'begin{${env}}\n\t${}\n\\end{${env}}', 'Start an environment'],
  ['end', 'end{${env}}', 'End an environment'],
  ['frac', 'frac{${num}}{${den}}', 'Fraction'],
  ['dfrac', 'dfrac{${num}}{${den}}', 'Display-size fraction'],
  ['sqrt', 'sqrt{${x}}', 'Square root'],
  ['sum', 'sum_{${i=1}}^{${n}}', 'Sum'],
  ['prod', 'prod_{${i=1}}^{${n}}', 'Product'],
  ['int', 'int_{${a}}^{${b}}', 'Integral'],
  ['iint', null, 'Double integral'],
  ['oint', null, 'Contour integral'],
  ['lim', 'lim_{${x \\to \\infty}}', 'Limit'],
  ['infty', null, 'Infinity'],
  ['partial', null, 'Partial derivative'],
  ['nabla', null, 'Nabla'],
  ['cdot', null, 'Centered dot'],
  ['cdots', null, 'Centered dots'],
  ['ldots', null, 'Low dots'],
  ['times', null, 'Times'],
  ['div', null, 'Division sign'],
  ['pm', null, 'Plus-minus'],
  ['leq', null, 'Less or equal'],
  ['geq', null, 'Greater or equal'],
  ['neq', null, 'Not equal'],
  ['approx', null, 'Approximately'],
  ['equiv', null, 'Equivalent'],
  ['sim', null, 'Similar'],
  ['propto', null, 'Proportional to'],
  ['in', null, 'Element of'],
  ['notin', null, 'Not an element of'],
  ['subset', null, 'Subset'],
  ['subseteq', null, 'Subset or equal'],
  ['cup', null, 'Union'],
  ['cap', null, 'Intersection'],
  ['emptyset', null, 'Empty set'],
  ['forall', null, 'For all'],
  ['exists', null, 'There exists'],
  ['rightarrow', null, 'Right arrow'],
  ['Rightarrow', null, 'Implies'],
  ['leftarrow', null, 'Left arrow'],
  ['Leftrightarrow', null, 'If and only if'],
  ['mapsto', null, 'Maps to'],
  ['to', null, 'Arrow'],
  ['mathbb', 'mathbb{${R}}', 'Blackboard bold (ℝ, ℕ…)'],
  ['mathbf', 'mathbf{${x}}', 'Bold math'],
  ['mathrm', 'mathrm{${d}}', 'Upright math'],
  ['mathcal', 'mathcal{${L}}', 'Calligraphic'],
  ['text', 'text{${words}}', 'Text inside math'],
  ['hat', 'hat{${x}}', 'Hat accent'],
  ['bar', 'bar{${x}}', 'Bar accent'],
  ['vec', 'vec{${v}}', 'Vector arrow'],
  ['dot', 'dot{${x}}', 'Dot accent'],
  ['overline', 'overline{${x}}', 'Overline'],
  ['left(', 'left( ${} \\right)', 'Scaled parentheses'],
  ['left[', 'left[ ${} \\right]', 'Scaled brackets'],
  ['left\\{', 'left\\\\{ ${} \\right\\\\}', 'Scaled braces'],
  ['sin', null, 'Sine'], ['cos', null, 'Cosine'], ['tan', null, 'Tangent'], ['log', null, 'Logarithm'], ['ln', null, 'Natural log'], ['exp', null, 'Exponential'], ['max', null, 'Maximum'], ['min', null, 'Minimum'],
  ...['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'].map((g) => [g, null, 'Greek letter']),
];

// [name, body, detail]: the body goes between \begin{name} and \end{name}.
const ENVIRONMENTS = [
  ['itemize', '\t\\item ${}', 'Bulleted list'],
  ['enumerate', '\t\\item ${}', 'Numbered list'],
  ['description', '\t\\item[${term}] ${}', 'Description list'],
  ['figure', '\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${file}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}', 'Figure with caption'],
  ['table', '\t\\centering\n\t\\begin{tabular}{${lll}}\n\t\t${}\n\t\\end{tabular}\n\t\\caption{${caption}}\n\t\\label{tab:${label}}', 'Table with caption'],
  ['tabular', '\t${} \\\\', 'Table grid'],
  ['equation', '\t${}', 'Numbered equation'],
  ['equation*', '\t${}', 'Unnumbered equation'],
  ['align', '\t${} &= ${} \\\\', 'Aligned equations (amsmath)'],
  ['align*', '\t${} &= ${} \\\\', 'Aligned, unnumbered'],
  ['gather', '\t${}', 'Centered equations'],
  ['multline', '\t${}', 'Long equation'],
  ['split', '\t${}', 'Split equation'],
  ['cases', '\t${} & \\text{if } ${} \\\\', 'Piecewise cases'],
  ['matrix', '\t${}', 'Matrix'],
  ['pmatrix', '\t${a} & ${b} \\\\\n\t${c} & ${d}', 'Matrix in ( )'],
  ['bmatrix', '\t${a} & ${b} \\\\\n\t${c} & ${d}', 'Matrix in [ ]'],
  ['array', '\t${}', 'Math array'],
  ['abstract', '\t${}', 'Abstract'],
  ['center', '\t${}', 'Centered block'],
  ['flushleft', '\t${}', 'Left-aligned block'],
  ['flushright', '\t${}', 'Right-aligned block'],
  ['quote', '\t${}', 'Quotation'],
  ['quotation', '\t${}', 'Long quotation'],
  ['verbatim', '${}', 'Text exactly as typed'],
  ['minipage', '\t${}', 'Box with its own width'],
  ['theorem', '\t${}', 'Theorem'],
  ['lemma', '\t${}', 'Lemma'],
  ['proof', '\t${}', 'Proof (amsthm)'],
  ['definition', '\t${}', 'Definition'],
  ['corollary', '\t${}', 'Corollary'],
  ['example', '\t${}', 'Example'],
  ['remark', '\t${}', 'Remark'],
  ['frame', '\t\\frametitle{${title}}\n\t${}', 'Slide (beamer)'],
  ['columns', '\t\\begin{column}{0.5\\textwidth}\n\t\t${}\n\t\\end{column}', 'Columns (beamer)'],
  ['block', '\t${}', 'Block (beamer)'],
  ['tikzpicture', '\t${}', 'Drawing (TikZ)'],
  ['lstlisting', '${}', 'Code listing (listings)'],
  ['subfigure', '\t${}', 'Sub-figure (subcaption)'],
  ['thebibliography', '\t\\bibitem{${key}} ${}', 'Hand-written bibliography'],
  ['algorithm', '\t${}', 'Algorithm float'],
  ['document', '${}', 'The document body'],
];

const PACKAGES = ['amsmath', 'amssymb', 'amsthm', 'mathtools', 'graphicx', 'hyperref', 'geometry', 'booktabs', 'xcolor', 'tikz', 'pgfplots', 'natbib', 'biblatex', 'cleveref', 'caption', 'subcaption', 'float', 'enumitem', 'fancyhdr', 'setspace', 'siunitx', 'listings', 'minted', 'algorithm', 'algpseudocode', 'algorithm2e', 'multirow', 'tabularx', 'longtable', 'array', 'url', 'microtype', 'fontenc', 'inputenc', 'lmodern', 'babel', 'csquotes', 'parskip', 'titlesec', 'tcolorbox', 'appendix', 'lipsum', 'xspace', 'physics', 'bm', 'mhchem', 'wrapfig', 'pdfpages', 'fontspec', 'svg'];
const CLASSES = ['article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'amsart', 'standalone', 'IEEEtran', 'revtex4-2', 'moderncv'];

const short = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const tidy = (s) => String(s || '').replace(/\\([a-zA-Z]+)\s*/g, '$1').replace(/[{}]/g, '');

// Replace up to and including a "}" closeBrackets already typed.
function withBrace(template) {
  return (view, completion, from, to) => {
    const after = view.state.sliceDoc(to, to + 1);
    snippet(template)(view, completion, from, after === '}' ? to + 1 : to);
  };
}

function commandOptions(project) {
  const out = COMMANDS.map(([name, body, detail]) => ({
    label: `\\${name}`,
    detail,
    type: /Greek/.test(detail) ? 'constant' : 'function',
    apply: body ? (view, c, from, to) => snippet(`\\${body}`)(view, c, from, to) : `\\${name}`,
  }));
  const known = new Set(COMMANDS.map((c) => c[0]));
  for (const c of project.commands) {
    if (known.has(c.name)) continue;
    known.add(c.name);
    const args = Array.from({ length: c.args }, (_, i) => `{\${arg${i + 1}}}`).join('');
    out.push({ label: `\\${c.name}`, detail: 'Defined in this project', type: 'variable', boost: 1, apply: args ? (view, comp, from, to) => snippet(`\\${c.name}${args}`)(view, comp, from, to) : `\\${c.name}` });
  }
  return out;
}

function envOptions(project, closing) {
  const envs = [...ENVIRONMENTS];
  for (const name of project.environments) if (!envs.some((e) => e[0] === name)) envs.push([name, '\t${}', 'Defined in this project']);
  return envs.map(([name, body, detail]) => ({
    label: name,
    detail,
    type: 'type',
    apply: closing ? withBrace(`${name}}`) : withBrace(`${name}}\n${body}\n\\end{${name}}`),
  }));
}

// project: { bib: [{key,title,author,year,file}], labels: [{label,context,file,line}],
//            files: [{path, kind}], commands, environments }
export function latexCompletions(getProject) {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(Math.max(0, line.from - 400), context.pos);
    const ctx = completionContext(before);
    if (!ctx) return null;
    const from = context.pos - (before.length - ctx.from);
    const project = getProject();
    if (ctx.kind === 'cite') {
      return {
        from,
        validFor: /^[^,}\s]*$/,
        options: project.bib.map((b) => ({
          label: b.key,
          detail: [tidy(b.author).split(/ and /)[0].split(',')[0], b.year].filter(Boolean).join(' '),
          info: [tidy(b.title), b.file].filter(Boolean).join('\n'),
          type: 'text',
        })),
      };
    }
    if (ctx.kind === 'ref') {
      return {
        from,
        validFor: /^[^,}\s]*$/,
        options: project.labels.map((l) => ({ label: l.label, detail: short(l.context, 40), info: `${l.file}:${l.line}`, type: 'keyword' })),
      };
    }
    if (ctx.kind === 'file') {
      const graphic = ['includegraphics', 'includepdf', 'includesvg'].includes(ctx.command);
      const bib = ['bibliography', 'addbibresource'].includes(ctx.command);
      const files = project.files.filter((f) => !f.dir && (graphic ? f.kind === 'image' : bib ? f.kind === 'bib' : f.kind === 'tex' || f.kind === 'text'));
      return {
        from,
        validFor: /^[^,}]*$/,
        options: files.map((f) => {
          const drop = ctx.command === 'bibliography' || (!graphic && !bib && /\.tex$/i.test(f.path));
          return { label: drop ? f.path.replace(/\.[^./]+$/, '') : f.path, type: 'text' };
        }),
      };
    }
    if (ctx.kind === 'package') return { from, validFor: /^[\w-]*$/, options: PACKAGES.map((p) => ({ label: p, type: 'namespace' })) };
    if (ctx.kind === 'class') return { from, validFor: /^[\w-]*$/, options: CLASSES.map((p) => ({ label: p, type: 'class' })) };
    if (ctx.kind === 'begin') return { from, validFor: /^[a-zA-Z*]*$/, options: envOptions(project, false) };
    if (ctx.kind === 'end') {
      const open = openEnvironment(context.state.sliceDoc(0, context.pos));
      const options = envOptions(project, true);
      if (open) {
        const top = options.find((o) => o.label === open);
        if (top) top.boost = 99;
        else options.unshift({ label: open, apply: withBrace(`${open}}`), boost: 99, type: 'type' });
      }
      return { from, validFor: /^[a-zA-Z*]*$/, options };
    }
    if (ctx.kind === 'command') {
      if (!context.explicit && ctx.prefix.length === 0 && before.endsWith('\\\\')) return null;
      return { from, validFor: /^\\[a-zA-Z@]*$/, options: commandOptions(project) };
    }
    return null;
  };
}

export { ENVIRONMENTS, COMMANDS };
