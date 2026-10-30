// Every function the formula engine knows, by upper-case name.

import array from './array.js';
import date from './date.js';
import eng from './eng.js';
import finance from './finance.js';
import google from './google.js';
import logic from './logic.js';
import lookup from './lookup.js';
import math from './math.js';
import query from './query.js';
import stats from './stats.js';
import text from './text.js';

export const FUNCTIONS = {
  ...eng, ...math, ...stats, ...text, ...date, ...logic, ...lookup, ...array, ...finance, ...query, ...google,
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
