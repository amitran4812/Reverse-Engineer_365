// Engineering: base conversions, bit operations, complex numbers, Bessel and error functions.

import { toNum } from '../core.js';
import { L, libCall } from './lib.js';
import { S } from './util.js';

const NAMES = {
  'BESSELI BESSELJ BESSELK BESSELY BITAND BITLSHIFT BITOR BITRSHIFT BITXOR COMPLEX DELTA GESTEP': [1, 3],
  'BIN2DEC BIN2HEX BIN2OCT DEC2BIN DEC2HEX DEC2OCT HEX2BIN HEX2DEC HEX2OCT OCT2BIN OCT2DEC OCT2HEX': [1, 2],
  'IMABS IMAGINARY IMARGUMENT IMCONJUGATE IMCOS IMCOSH IMCOT IMCSC IMCSCH IMEXP IMLN IMLOG10 IMLOG2 IMREAL IMSEC IMSECH IMSIN IMSINH IMSQRT IMTAN ERFC': [1, 1],
  'IMDIV IMPOWER IMSUB': [2, 2],
};

const ENG = {};
for (const [names, [min, max]] of Object.entries(NAMES)) for (const n of names.split(' ')) ENG[n] = L(n, { min, max });
ENG.IMSUM = L('IMSUM', { arrays: () => true, min: 1 });
ENG.IMPRODUCT = L('IMPRODUCT', { arrays: () => true, min: 1 });

const parts = (z) => [libCall('IMREAL', z), libCall('IMAGINARY', z)];
const complex = (a, b) => libCall('COMPLEX', Number(a.toPrecision(15)), Number(b.toPrecision(15)));
const tanh = (z) => {
  const [a, b] = parts(z);
  const d = Math.cosh(2 * a) + Math.cos(2 * b);
  return [Math.sinh(2 * a) / d, Math.sin(2 * b) / d];
};

Object.assign(ENG, {
  IMTANH: S((z) => complex(...tanh(z)), { min: 1, max: 1 }),
  IMCOTH: S((z) => {
    const [x, y] = tanh(z);
    const m = x * x + y * y;
    return complex(x / m, -y / m);
  }, { min: 1, max: 1 }),
  IMLOG: S((z, base) => {
    const [a, b] = parts(libCall('IMLN', z));
    const l = Math.log(toNum(base));
    return complex(a / l, b / l);
  }, { min: 2, max: 2 }),
  ERF: S((lo, hi) => (hi === undefined ? libCall('ERF', toNum(lo)) : libCall('ERF', toNum(hi)) - libCall('ERF', toNum(lo))), { min: 1, max: 2 }),
  'ERF.PRECISE': S((x) => libCall('ERF', toNum(x)), { min: 1, max: 1 }),
  'ERFC.PRECISE': S((x) => libCall('ERFC', toNum(x)), { min: 1, max: 1 }),
});

export default ENG;
