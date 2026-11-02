'use strict';
/* Verificador de contraseña de apertura de PDF, en segundo plano.
   Comprueba la contraseña contra el diccionario de cifrado del propio PDF
   (no abre el documento en cada intento), por lo que es rápido y no satura
   la memoria. Soporta el handler estándar: RC4/AES-128 (R2-R4, con MD5+RC4)
   y AES-256 (R5/R6, con SHA/AES vía WebCrypto). Todo local. */

const WC = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : (typeof require !== 'undefined' ? require('crypto').webcrypto : null);

const PAD = [0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A];

function md5(bytes) {
  const rl = (x, c) => (x << c) | (x >>> (32 - c));
  const add = (a, b) => (a + b) | 0;
  const len = bytes.length, nBlocks = (((len + 8) >> 6) + 1);
  const M = new Int32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[len >> 2] |= 0x80 << ((len % 4) * 8);
  M[nBlocks * 16 - 2] = len * 8;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = []; for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
  for (let blk = 0; blk < nBlocks; blk++) {
    const off = blk * 16; let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | ((~B) & D); g = i; }
      else if (i < 32) { F = (D & B) | ((~D) & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | (~D)); g = (7 * i) % 16; }
      F = add(add(add(F, A), K[i]), M[off + g]);
      A = D; D = C; C = B; B = add(B, rl(F, S[i]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  const out = [];
  [a0, b0, c0, d0].forEach(x => { for (let i = 0; i < 4; i++) out.push((x >>> (i * 8)) & 255); });
  return out;
}

function rc4(key, data) {
  const S = new Array(256); for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0; for (let i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = new Array(data.length); let a = 0, b = 0;
  for (let k = 0; k < data.length; k++) { a = (a + 1) & 255; b = (b + S[a]) & 255; const t = S[a]; S[a] = S[b]; S[b] = t; out[k] = data[k] ^ S[(S[a] + S[b]) & 255]; }
  return out;
}

async function sha(bits, bytes) { const d = await WC.subtle.digest('SHA-' + bits, new Uint8Array(bytes)); return [...new Uint8Array(d)]; }
// AES-128-CBC sin relleno: WebCrypto añade un bloque PKCS7; como la entrada es múltiplo de 16, los bloques previos coinciden con el modo sin relleno, así que descartamos el último bloque.
async function aesCbcNoPad(key, iv, data) {
  const k = await WC.subtle.importKey('raw', new Uint8Array(key), { name: 'AES-CBC' }, false, ['encrypt']);
  const ct = new Uint8Array(await WC.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(iv) }, k, new Uint8Array(data)));
  return [...ct.subarray(0, data.length)];
}

function toLatin1(s) { const o = []; for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255); return o; }
function toUtf8(s) { return [...new TextEncoder().encode(s)]; }

function makeVerifier(p) {
  const O = p.O, U = p.U, id = p.id || [], R = p.R, V = p.V, n = Math.max(5, Math.min(16, (p.length || 40) / 8));
  if (V >= 5) {
    const valSalt = U.slice(32, 40);
    return async (pwStr) => {
      const pw = toUtf8(pwStr);
      const h = (R === 5) ? await sha(256, pw.concat(valSalt)) : await hash2B(pw, valSalt, []);
      for (let i = 0; i < 32; i++) if (h[i] !== U[i]) return false;
      return true;
    };
  }
  // R2-R4: MD5 + RC4
  const pbytes = [p.P & 255, (p.P >> 8) & 255, (p.P >> 16) & 255, (p.P >> 24) & 255];
  const computeKey = (pw) => {
    let input = pw.concat(PAD).slice(0, 32).concat(O.slice(0, 32)).concat(pbytes).concat(id);
    if (R >= 4 && p.encryptMetadata === false) input = input.concat([0xff, 0xff, 0xff, 0xff]);
    let h = md5(input);
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
    return h.slice(0, n);
  };
  return (pwStr) => {
    const key = computeKey(toLatin1(pwStr));
    let u;
    if (R === 2) { u = rc4(key, PAD); }
    else { let h = md5(PAD.concat(id)); let v = rc4(key, h); for (let i = 1; i <= 19; i++) v = rc4(key.map(b => b ^ i), v); u = v; }
    const cmp = R === 2 ? 32 : 16;
    for (let i = 0; i < cmp; i++) if (u[i] !== U[i]) return false;
    return true;
  };
}

// Algoritmo 2.B (R6)
async function hash2B(pw, salt, udata) {
  udata = udata || [];
  let K = await sha(256, pw.concat(salt).concat(udata));
  let round = 0;
  for (;;) {
    const unit = pw.concat(K).concat(udata);
    let K1 = []; for (let i = 0; i < 64; i++) K1 = K1.concat(unit);
    const E = await aesCbcNoPad(K.slice(0, 16), K.slice(16, 32), K1);
    let mod = 0; for (let i = 0; i < 16; i++) mod = (mod + E[i]) % 3;
    K = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, E);
    round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
  }
  return K.slice(0, 32);
}

function* bruteGen(charset, min, max) {
  const cs = [...new Set(charset.split(''))]; if (!cs.length) return;
  for (let len = Math.max(1, min); len <= max; len++) {
    const idx = new Array(len).fill(0);
    for (;;) {
      yield idx.map(i => cs[i]).join('');
      let p = len - 1; for (; p >= 0; p--) { if (++idx[p] < cs.length) break; idx[p] = 0; }
      if (p < 0) break;
    }
  }
}

const COMMON = ['123456','password','12345678','123456789','12345','1234','111111','1234567','123123','admin','000000','654321','qwerty','abc123','password1','1234567890','contraseña','contrasena','123','1111','0000','123321','clave','usuario','bolivia','cambiar','documento','pdf','2020','2021','2022','2023','2024','2025','2026','11111111','123654','666666','888888','777777','555555','121212','112233','102030','147258369','159753','aaaaaa','qwertyuiop','1q2w3e4r','12341234','987654321','1qaz2wsx','secret','master','gamaliel','familia','amor','hola','enter','root','toor'];

function* autoGen() {
  for (const w of COMMON) yield w;
  yield* bruteGen('0123456789', 1, 6);
  yield* bruteGen('abcdefghijklmnopqrstuvwxyz', 1, 4);
  yield* bruteGen('abcdefghijklmnopqrstuvwxyz0123456789', 1, 4);
}

function makeGen(job) {
  if (job.type === 'dict') return job.words[Symbol.iterator]();
  if (job.type === 'brute') return bruteGen(job.charset || '0123456789', job.min || 1, job.max || 5);
  return autoGen();
}

async function run(data, post) {
  const verify = makeVerifier(data.params);
  const gen = makeGen(data.job);
  const t0 = Date.now(); let n = 0;
  const async5 = data.params.V >= 5;
  const step = async5 ? 25 : 3000;
  for (const pw of gen) {
    n++;
    const ok = async5 ? await verify(pw) : verify(pw);
    if (ok) { post({ found: pw, tried: n }); return; }
    if (n % step === 0) { post({ progress: true, tried: n, pwd: pw, rate: n / ((Date.now() - t0) / 1000) }); if (async5) await new Promise(r => setTimeout(r, 0)); }
  }
  post({ done: true, tried: n });
}

if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined' || typeof self !== 'undefined') {
  self.onmessage = (e) => { run(e.data, (m) => self.postMessage(m)).catch(err => self.postMessage({ error: String(err && err.message || err) })); };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { md5, rc4, makeVerifier, bruteGen, autoGen, run, hash2B };
