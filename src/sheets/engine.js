// Formula evaluation for the spreadsheet. The engine in ./formula follows
// Google Sheets: array math, spilling results, LET/LAMBDA, QUERY and the
// live-data functions (GOOGLEFINANCE, IMPORTRANGE…), with Excel's functions too.

import { FormulaError, literal } from './formula/core.js';
import { evaluateBook } from './formula/evaluate.js';

export { literal };
export { FUNCTION_NAMES } from './formula/fns/index.js';

export const isError = (v) => v instanceof FormulaError || (typeof v === 'string' && /^#[A-Z/0!?]+[!?]?$/.test(v) && v.length < 9);
export const errorText = (v) => (v instanceof FormulaError ? v.error : String(v));

// Computes every cell of every sheet. Returns { [sheetName]: Map(ref -> value) },
// including cells filled by spilled array results. env.web supplies live data.
export function computeBook(book, env = {}) {
  return evaluateBook(book, env);
}

// Excel serial date <-> JS date (1900 date system).
export function serialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

export function format(v, style = {}) {
  if (v == null) return '';
  if (v instanceof FormulaError) return v.error;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM!';
    const dec = style.dec;
    const fixed = (d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    switch (style.fmt) {
      case 'number': return fixed(dec ?? 2);
      case 'integer': return fixed(0);
      case 'currency': return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 })}`;
      case 'percent': return `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 0 })}%`;
      case 'date': return serialToDate(v).toISOString().slice(0, 10);
      default:
        if (dec != null) return fixed(dec);
        if (Number.isInteger(v)) return String(v);
        return String(Number(v.toPrecision(11)));
    }
  }
  return String(v);
}
