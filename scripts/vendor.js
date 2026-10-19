// Copia las librerías dentro de www/vendor para que el programa funcione sin internet.
// También descarga los idiomas del OCR (español e inglés).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'www', 'vendor');
fs.mkdirSync(OUT, { recursive: true });

let missing = 0;
function copy(from, to) {
  const src = path.join(NM, from), dst = path.join(OUT, to);
  if (!fs.existsSync(src)) { console.warn('  FALTA ' + from); missing++; return false; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('  ok  ' + to);
  return true;
}

console.log('Librerías:');
copy('pdfjs-dist/build/pdf.min.js', 'pdf.min.js');
copy('pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js');
copy('pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js');
copy('jszip/dist/jszip.min.js', 'jszip.min.js');
copy('xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js');
copy('tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js');
copy('tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js');
const coreDir = path.join(NM, 'tesseract.js-core');
if (fs.existsSync(coreDir)) {
  for (const f of fs.readdirSync(coreDir)) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy('tesseract.js-core/' + f, 'tesseract-core/' + f);
} else { console.warn('  FALTA tesseract.js-core'); missing++; }

console.log('Tipografías:');
const faces = [
  ['ibm-plex-sans', 'IBM Plex Sans', [400, 500, 600]],
  ['ibm-plex-mono', 'IBM Plex Mono', [500]],
  ['bricolage-grotesque', 'Bricolage Grotesque', [600, 800]]
];
let css = '';
for (const [id, family, weights] of faces) {
  for (const w of weights) {
    const file = `${id}-latin-${w}-normal.woff2`;
    if (copy(`@fontsource/${id}/files/${file}`, 'fonts/' + file)) {
      css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url("fonts/${file}") format("woff2")}\n`;
    }
  }
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), css);

async function lang(code) {
  const dst = path.join(OUT, 'lang', code + '.traineddata.gz');
  if (fs.existsSync(dst) && fs.statSync(dst).size > 100000) { console.log('  ok  lang/' + code + ' (ya estaba)'); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const sources = [
    [`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`, true],
    [`https://github.com/tesseract-ocr/tessdata_fast/raw/main/${code}.traineddata`, false]
  ];
  for (const [url, gz] of sources) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let buf = Buffer.from(await r.arrayBuffer());
      if (!gz) buf = zlib.gzipSync(buf);
      if (buf.length < 100000) throw new Error('archivo demasiado pequeño');
      fs.writeFileSync(dst, buf);
      console.log(`  ok  lang/${code} (${(buf.length / 1e6).toFixed(1)} MB)`);
      return;
    } catch (e) { console.warn(`  no se pudo bajar ${url}: ${e.message}`); }
  }
  console.warn('  FALTA idioma ' + code + ' (el OCR lo descargará cuando haya internet)');
}

(async () => {
  console.log('Idiomas del OCR:');
  await lang('spa');
  await lang('eng');
  console.log(missing ? `Listo, con ${missing} archivo(s) faltante(s).` : 'Listo.');
})();
