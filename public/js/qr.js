// Gerador de QR Code (ISO/IEC 18004) — modo byte, correção de erro nível M, versões 1 a 10.
// Sem dependências. Saída: matriz de módulos ou SVG.
// Estrutura inspirada na referência pública de Project Nayuki (algoritmo, não código copiado de pacote).

const MAX_VERSION = 10;
// Nível M: codewords de correção por bloco e número de blocos, por versão (índice 0 não usado).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ECC_FORMAT_BITS_M = 0; // L=1, M=0, Q=3, H=2

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

// ---------- Reed-Solomon sobre GF(256), polinômio 0x11D ----------
function rsMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= rsMul(divisor[i], factor);
  }
  return result;
}

// ---------- Codificação dos dados ----------
function utf8Bytes(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function buildDataCodewords(bytes, ver) {
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // modo byte
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = numDataCodewords(ver) * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminador
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let pad = 0xec; out.length < numDataCodewords(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data, ver) {
  const numBlocks = NUM_BLOCKS[ver];
  const blockEccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---------- Matriz ----------
function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function makeGrid(size, fill) {
  return Array.from({ length: size }, () => new Array(size).fill(fill));
}

function buildMatrix(ver, codewords, mask) {
  const size = ver * 4 + 17;
  const modules = makeGrid(size, false);
  const isFunc = makeGrid(size, false);
  const setF = (x, y, dark) => {
    modules[y][x] = dark;
    isFunc[y][x] = true;
  };

  // Padrões de temporização
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  // Padrões localizadores (com separadores)
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Padrões de alinhamento
  const pos = alignmentPositions(ver, size);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Reserva área de formato (valores definitivos depois)
  drawFormat(setF, size, 0);
  // Informação de versão (v >= 7)
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setF(a, b, bit);
      setF(b, a, bit);
    }
  }

  // Dados em zigue-zague
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && bitIndex < totalBits) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  applyMask(modules, isFunc, mask);
  drawFormat(setF, size, mask);
  return modules;
}

function drawFormat(setF, size, mask) {
  const data = (ECC_FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) setF(8, i, getBit(bits, i));
  setF(8, 7, getBit(bits, 6));
  setF(8, 8, getBit(bits, 7));
  setF(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setF(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setF(8, size - 15 + i, getBit(bits, i));
  setF(8, size - 8, true); // módulo escuro fixo
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(modules, isFunc, mask) {
  const fn = MASKS[mask];
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunc[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

// Penalidade (regras N1–N4 da norma) para escolher a melhor máscara.
function penalty(m) {
  const size = m.length;
  let score = 0;
  const line = (get) => {
    for (let a = 0; a < size; a++) {
      let runColor = null;
      let run = 0;
      for (let b = 0; b < size; b++) {
        const c = get(a, b);
        if (c === runColor) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          runColor = c;
          run = 1;
        }
      }
      // N3: 1:1:3:1:1 com 4 claros de um lado
      for (let b = 0; b + 10 < size + 4; b++) {
        const v = (k) => (k >= 0 && k < size ? get(a, k) : false);
        const p = [true, false, true, true, true, false, true];
        let core = true;
        for (let k = 0; k < 7; k++) if (v(b + k) !== p[k]) { core = false; break; }
        if (!core) continue;
        const before = !v(b - 1) && !v(b - 2) && !v(b - 3) && !v(b - 4);
        const after = !v(b + 7) && !v(b + 8) && !v(b + 9) && !v(b + 10);
        if (before || after) score += 40;
      }
    }
  };
  line((a, b) => m[a][b]);
  line((a, b) => m[b][a]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 100 / total - 50) / 5) * 10;
  return score;
}

/**
 * Gera a matriz do QR Code.
 * @param {string} text
 * @param {{ mask?: number, minVersion?: number }} [opts] mask forçada (0–7) para testes
 * @returns {{ version: number, size: number, mask: number, modules: boolean[][] }}
 */
export function encodeQR(text, opts = {}) {
  const bytes = utf8Bytes(text);
  let ver = Math.max(1, opts.minVersion || 1);
  for (; ver <= MAX_VERSION; ver++) {
    const needBits = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (needBits <= numDataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('Texto longo demais para o QR Code.');
  const codewords = addEccAndInterleave(buildDataCodewords(bytes, ver), ver);
  if (opts.mask !== undefined) {
    return { version: ver, size: ver * 4 + 17, mask: opts.mask, modules: buildMatrix(ver, codewords, opts.mask) };
  }
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = buildMatrix(ver, codewords, mask);
    const p = penalty(modules);
    if (!best || p < best.p) best = { p, mask, modules };
  }
  return { version: ver, size: ver * 4 + 17, mask: best.mask, modules: best.modules };
}

/**
 * Gera um SVG do QR Code (string).
 * @param {string} text
 * @param {{ quiet?: number, dark?: string, light?: string, label?: string }} [opts]
 */
export function qrSVG(text, opts = {}) {
  const { quiet = 4, dark = '#0b1b2b', light = '#ffffff', label = 'QR Code' } = opts;
  const { size, modules } = encodeQR(text);
  const full = size + quiet * 2;
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const esc = String(label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="${esc}"><rect width="${full}" height="${full}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
