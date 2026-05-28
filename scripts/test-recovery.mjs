// Smoke-test the recovery pipeline by running web/recovery.js in a Node 22
// sandbox against a synthetic, deliberately-broken .odt.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

class FakeDOMParser {
  parseFromString() { return { querySelector: () => null }; }
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}
const crc32 = (b) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const deflate = async (b) => {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter(); w.write(b); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
};

// Build a tiny synthetic, valid .odt. The `mimetype` member is stored first
// (method 0), exactly as the ODF spec requires.
async function makeFakeOdt() {
  const enc = new TextEncoder();
  const files = {
    'mimetype': { text: 'application/vnd.oasis.opendocument.text', store: true },
    'META-INF/manifest.xml': { text:
      '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '</manifest:manifest>' },
    'styles.xml': { text: '<?xml version="1.0"?><office:document-styles xmlns:office="urn:x"/>' },
    'meta.xml': { text: '<?xml version="1.0"?><office:document-meta xmlns:office="urn:x"/>' },
    'content.xml': { text:
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:o" xmlns:text="urn:t">' +
      '<office:body><office:text>' +
      '<text:h text:outline-level="1">Recovered Heading</text:h>' +
      '<text:p>Hello recovery world</text:p>' +
      '<text:p>Second paragraph<text:tab/>after a tab</text:p>' +
      '</office:text></office:body></office:document-content>' },
  };

  const localChunks = [], cdChunks = [];
  let offset = 0;
  for (const name of Object.keys(files)) {
    const raw = enc.encode(files[name].text);
    const store = !!files[name].store;
    const data = store ? raw : await deflate(raw);
    const method = store ? 0 : 8;
    const nameBytes = enc.encode(name);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    localChunks.push(lh, data);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc32(raw), true); cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    cdChunks.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = cdChunks.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...localChunks, ...cdChunks, eocd];
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

function makeSandbox() {
  const elements = {};
  const meta = {};
  const listeners = {};
  const downloads = [];
  const blobs = new Map();

  const makeEl = (id) => ({
    id,
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {},
    addEventListener(ev, fn) { (listeners[id] ||= {})[ev] = fn; },
    appendChild() {},
    querySelector: () => null,
    set textContent(v) { meta[id] = v; },
    get textContent() { return meta[id] || ''; },
    set innerHTML(v) { meta[id + '_html'] = v; },
    get innerHTML() { return meta[id + '_html'] || ''; },
    scrollTop: 0, scrollHeight: 0,
    open: false,
    remove: () => {},
    disabled: false,
    files: [],
    value: '',
    click: () => {}
  });

  const document = {
    getElementById(id) { return elements[id] ||= makeEl(id); },
    createElement(t) { const node = makeEl('_' + t); node.tagName = t; return node; },
    addEventListener: () => {},
    body: { appendChild(node) { downloads.push(node); } },
    readyState: 'complete'
  };

  const URLshim = {
    createObjectURL: (b) => { const u = 'blob:' + Math.random(); blobs.set(u, b); return u; },
    revokeObjectURL: () => {}
  };

  const sandbox = {
    document,
    DOMParser: FakeDOMParser,
    DecompressionStream, CompressionStream,
    TextEncoder, TextDecoder, DataView,
    Uint8Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer,
    Blob, Response,
    URL: URLshim,
    console,
    setTimeout, clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.navigator = { serviceWorker: undefined };

  return { sandbox, elements, meta, listeners, downloads, blobs };
}

async function runRecovery(bytes, label) {
  const env = makeSandbox();
  const ctx = vm.createContext(env.sandbox);
  const code = fs.readFileSync(path.join(WEB, 'recovery.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'recovery.js' });

  const file = new File([bytes], `${label}.odt`, {
    type: 'application/vnd.oasis.opendocument.text'
  });
  env.elements['file'].files = [file];
  const handler = env.listeners['file'] && env.listeners['file'].change;
  if (!handler) throw new Error('file change listener not registered');
  handler();
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const status = env.meta['status'] || '';
    if (env.meta['m-entries'] != null) break;
    if (status.startsWith('Recovery failed') || status.startsWith('Could not')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return env;
}

(async () => {
  const ok = (m) => console.log('  \x1b[32mOK\x1b[0m', m);
  const bad = (m) => { console.log('  \x1b[31mFAIL\x1b[0m', m); process.exitCode = 1; };

  const good = await makeFakeOdt();
  console.log('Synthetic .odt size:', good.length);

  console.log('\n[1] well-formed odt');
  const r1 = await runRecovery(good, 'good');
  console.log('  meta:', r1.meta);
  if (r1.meta['m-entries'] === '5') ok('all 5 entries recovered');
  else bad('m-entries=' + r1.meta['m-entries']);
  if (r1.meta['m-paras'] === '3') ok('3 paragraphs detected');
  else bad('m-paras=' + r1.meta['m-paras']);
  if (r1.meta['m-strategy'] === 'standard') ok('standard strategy used');
  else bad('strategy=' + r1.meta['m-strategy']);

  console.log('\n[2] truncated archive (no central directory)');
  const cut = good.slice(0, good.length - 200);
  const r2 = await runRecovery(cut, 'cut');
  console.log('  meta:', r2.meta);
  if (parseInt(r2.meta['m-entries']) >= 3) ok('low-level scan recovered ' + r2.meta['m-entries'] + ' entries');
  else bad('m-entries=' + r2.meta['m-entries']);
  if (r2.meta['m-strategy'] === 'low-level scan') ok('fell back to low-level scan');
  else bad('strategy=' + r2.meta['m-strategy']);

  console.log('\n[3] CD bytes mangled');
  const mangled = good.slice();
  for (let i = mangled.length - 22; i >= 0; i--) {
    if (mangled[i] === 0x50 && mangled[i+1] === 0x4B && mangled[i+2] === 0x05 && mangled[i+3] === 0x06) {
      const cdOff = mangled[i+16] | (mangled[i+17]<<8) | (mangled[i+18]<<16) | (mangled[i+19]<<24);
      mangled[cdOff + 8] = 0xFF; mangled[cdOff + 9] = 0xFF;
      break;
    }
  }
  const r3 = await runRecovery(mangled, 'mangled');
  console.log('  meta:', r3.meta);
  if (parseInt(r3.meta['m-entries']) >= 3) ok('recovered ' + r3.meta['m-entries'] + ' entries despite CD corruption');
  else bad('m-entries=' + r3.meta['m-entries']);

  console.log('\nDone.');
})().catch((e) => { console.error(e); process.exit(2); });
