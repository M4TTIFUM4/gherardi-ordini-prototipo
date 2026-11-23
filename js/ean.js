// EAN-13: cifra di controllo, etichette a peso variabile e disegno del codice a barre in SVG.

export function checkDigit(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

export const isValidEan13 = (c) => /^\d{13}$/.test(c) && checkDigit(c.slice(0, 12)) === c[12];

// Etichetta a peso variabile (uso interno GS1, prefisso 21): 21 + PLU(5) + grammi(5) + controllo.
export function weightEan(plu, kg) {
  const g = Math.max(0, Math.min(99999, Math.round(kg * 1000)));
  const d12 = '21' + String(plu).padStart(5, '0') + String(g).padStart(5, '0');
  return d12 + checkDigit(d12);
}
export function parseWeightEan(code) {
  if (!/^21\d{11}$/.test(code) || !isValidEan13(code)) return null;
  return { plu: code.slice(2, 7), kg: +code.slice(7, 12) / 1000 };
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Bits(code) {
  const p = PARITY[+code[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'L' ? L : G)[+code[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[+code[i]];
  return bits + '101';
}

// Ritorna un <svg> con barre e cifre leggibili. Le barre di guardia sono più lunghe, come da standard.
export function ean13Svg(code, { height = 60, module = 2 } = {}) {
  if (!isValidEan13(code)) return '';
  const bits = ean13Bits(code);
  const quiet = 11, w = (bits.length + quiet * 2) * module, text = 13;
  const guard = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  let rects = '';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    let j = i;
    while (j + 1 < bits.length && bits[j + 1] === '1' && guard.has(j + 1) === guard.has(i)) j++;
    const h = guard.has(i) ? height + text * 0.55 : height;
    rects += `<rect x="${(quiet + i) * module}" y="0" width="${(j - i + 1) * module}" height="${h}"/>`;
    i = j;
  }
  const fs = text * module * 0.62;
  const y = height + text * 0.55 + fs * 0.35;
  const digits = `<text x="${(quiet - 7) * module}" y="${y}">${code[0]}</text>` +
    `<text x="${(quiet + 3 + 21) * module}" y="${y}" text-anchor="middle" letter-spacing="${module * 1.6}">${code.slice(1, 7)}</text>` +
    `<text x="${(quiet + 50 + 21) * module}" y="${y}" text-anchor="middle" letter-spacing="${module * 1.6}">${code.slice(7)}</text>`;
  const H = height + text * 0.55 + fs;
  return `<svg class="ean" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${H}" role="img" aria-label="EAN ${code}"><rect width="${w}" height="${H}" fill="#fff"/><g fill="#000">${rects}</g><g font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${fs}" fill="#000">${digits}</g></svg>`;
}
