'use strict';

// Word counts for LaTeX source, the way journals count them: words in the text, in
// headings and in captions, plus how many inline and display equations there are.
// Commands, comments, maths and the preamble don't count as words.

const DISPLAY_ENVS = 'equation|equation\\*|align|align\\*|gather|gather\\*|multline|multline\\*|eqnarray|eqnarray\\*|displaymath|math';
const SKIP_ENVS = 'tabular|tabular\\*|tabularx|verbatim|lstlisting|minted|tikzpicture|thebibliography';
const HEAD = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|title)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const CAPTION = /\\caption\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;

const countWords = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

function plain(s) {
  return s
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, ' ')
    .replace(/\\(?:cite|citep|citet|ref|eqref|autoref|cref|Cref|label|pageref|url|includegraphics|input|include|bibliography|bibliographystyle|usepackage|documentclass|newcommand|renewcommand|vspace|hspace|setlength|addtolength)\*?\s*(?:\[[^\]]*\])*\s*\{[^{}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/\\./g, ' ')
    .replace(/[{}\[\]~&^_$]/g, ' ');
}

function texCount(source) {
  let text = String(source || '').replace(/(^|[^\\])%.*$/gm, '$1');
  const begin = text.indexOf('\\begin{document}');
  if (begin >= 0) text = text.slice(begin + '\\begin{document}'.length);
  text = text.replace(/\\end\{document\}[\s\S]*$/, '');
  let display = 0;
  text = text.replace(new RegExp(`\\\\begin\\{(${DISPLAY_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), () => {
    display += 1;
    return ' ';
  });
  text = text.replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g, () => {
    display += 1;
    return ' ';
  });
  let inline = 0;
  text = text.replace(/\\\([\s\S]*?\\\)|\$(?:\\.|[^$\\])+\$/g, () => {
    inline += 1;
    return ' ';
  });
  text = text.replace(new RegExp(`\\\\begin\\{(${SKIP_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), ' ');
  let headers = 0;
  let heads = 0;
  text = text.replace(HEAD, (m, body) => {
    heads += 1;
    headers += countWords(plain(body));
    return ' ';
  });
  let captions = 0;
  let figures = 0;
  text = text.replace(CAPTION, (m, body) => {
    figures += 1;
    captions += countWords(plain(body));
    return ' ';
  });
  const words = countWords(plain(text));
  return { words, headers, captions, total: words + headers + captions, headings: heads, floats: figures, inline, display };
}

module.exports = { texCount };
