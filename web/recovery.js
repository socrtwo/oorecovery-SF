/*
 * OO Recovery — pure-browser repair for corrupt OpenDocument files
 * (.odt / .ods / .odp and their OpenOffice.org 1.x .sx? predecessors).
 *
 * Strategy:
 *   1. Try to parse the ZIP central directory normally.
 *   2. If that fails or yields nothing, scan the byte stream for ZIP local
 *      file headers (PK\x03\x04) and recover entries one by one.
 *   3. For each .xml entry, validate (and best-effort repair) the XML.
 *   4. Repackage all recovered entries as a fresh, well-formed ODF zip
 *      (the `mimetype` member is written first and STORED, as ODF requires).
 *   5. As a last resort, emit a plain-text dump of all <text:p>/<text:h> runs
 *      pulled from content.xml.
 *
 * Implementation notes:
 *   - Decompression uses the Immortal Inflater (immortal-inflate.js) — a
 *     fault-tolerant pure-JS DEFLATE decoder, so reading needs no browser codec.
 *   - Output re-compression uses CompressionStream when available, else STORED.
 */

(() => {
  'use strict';

  const SIG_LFH = 0x04034b50; // PK\x03\x04 — local file header
  const SIG_CDH = 0x02014b50; // PK\x01\x02 — central directory header
  const SIG_EOCD = 0x06054b50; // PK\x05\x06 — end of central directory

  // ODF mimetype strings, keyed by file extension.
  const ODF_MIME = {
    odt: 'application/vnd.oasis.opendocument.text',
    ott: 'application/vnd.oasis.opendocument.text-template',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
    odp: 'application/vnd.oasis.opendocument.presentation',
    otp: 'application/vnd.oasis.opendocument.presentation-template',
    odg: 'application/vnd.oasis.opendocument.graphics',
    odf: 'application/vnd.oasis.opendocument.formula',
    // Legacy OpenOffice.org 1.x (uses a different container but still a zip).
    sxw: 'application/vnd.sun.xml.writer',
    sxc: 'application/vnd.sun.xml.calc',
    sxi: 'application/vnd.sun.xml.impress'
  };

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Decompression uses the Immortal Inflater — a fault-tolerant pure-JS
  // DEFLATE decoder (from socrtwo/Universal-File-Repair-Tool). Unlike the
  // browser's DecompressionStream it never throws on a corrupt or truncated
  // stream; it returns whatever bytes it could recover plus an isCorrupt flag.
  // Loaded as a global from immortal-inflate.js (UMD) — also works in Node.
  const _Inflate = (typeof ImmortalInflate !== 'undefined')
    ? ImmortalInflate
    : (typeof require !== 'undefined' ? require('./immortal-inflate.js') : null);

  function inflateImmortal(bytes) {
    if (!_Inflate) throw new Error('Immortal Inflater not loaded');
    return _Inflate(bytes); // { data: Uint8Array, isCorrupt: boolean }
  }

  // Output (re-)compression. We control this data (it is already valid), so a
  // standard deflate is fine; fall back to STORED when CompressionStream is
  // unavailable so the app works even without the Streams API.
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')));
      return new Uint8Array(await stream.arrayBuffer());
    } catch (_) { return null; }
  }

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }

  // ---------- Strategy 1: standard parse ----------

  function findEOCD(bytes) {
    const max = Math.min(bytes.length - 22, 65557);
    for (let i = bytes.length - 22; i >= bytes.length - max - 1 && i >= 0; i--) {
      if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  async function parseStandard(bytes, log) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEOCD(bytes);
    if (eocd < 0) {
      log.warn('No End-Of-Central-Directory record found.');
      return null;
    }
    const cdSize = readU32(view, eocd + 12);
    const cdOffset = readU32(view, eocd + 16);
    if (cdOffset + cdSize > bytes.length) {
      log.warn(`Central directory points past EOF (offset ${cdOffset}, size ${cdSize}).`);
      return null;
    }
    const entries = [];
    let p = cdOffset;
    while (p < cdOffset + cdSize - 46) {
      if (readU32(view, p) !== SIG_CDH) {
        log.warn(`Central directory header missing at offset ${p}.`);
        break;
      }
      const compMethod = readU16(view, p + 10);
      const compSize = readU32(view, p + 20);
      const uncompSize = readU32(view, p + 24);
      const nameLen = readU16(view, p + 28);
      const extraLen = readU16(view, p + 30);
      const commentLen = readU16(view, p + 32);
      const localOffset = readU32(view, p + 42);
      const name = new TextDecoder('utf-8').decode(bytes.slice(p + 46, p + 46 + nameLen));
      entries.push({ name, compMethod, compSize, uncompSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    log.info(`Found ${entries.length} entries via central directory.`);
    return await extractEntries(bytes, entries, log);
  }

  // ---------- Strategy 2: low-level header scan ----------

  async function parseScan(bytes, log) {
    log.info('Scanning byte stream for local file headers…');
    const entries = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i + 30 <= bytes.length; i++) {
      if (bytes[i] !== 0x50 || bytes[i+1] !== 0x4B || bytes[i+2] !== 0x03 || bytes[i+3] !== 0x04) continue;
      try {
        const compMethod = readU16(view, i + 8);
        const compSize = readU32(view, i + 18);
        const nameLen = readU16(view, i + 26);
        const extraLen = readU16(view, i + 28);
        if (nameLen === 0 || nameLen > 4096) continue;
        const nameStart = i + 30;
        const nameEnd = nameStart + nameLen;
        if (nameEnd > bytes.length) continue;
        const name = new TextDecoder('utf-8').decode(bytes.slice(nameStart, nameEnd));
        if (!/^[\w\-\.\/\[\] ()]+$/.test(name)) continue;
        entries.push({ name, compMethod, compSize, localOffset: i });
        i = nameEnd + extraLen + (compSize > 0 ? compSize : 0) - 1;
      } catch (_) { /* skip */ }
    }
    log.info(`Scan found ${entries.length} candidate entries.`);
    return await extractEntries(bytes, entries, log, /* tolerant */ true);
  }

  async function extractEntries(bytes, entries, log, tolerant = false) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = {};
    for (const e of entries) {
      try {
        if (readU32(view, e.localOffset) !== SIG_LFH) {
          log.warn(`Skipping ${e.name}: bad local header.`);
          continue;
        }
        const lhMethod = readU16(view, e.localOffset + 8);
        let lhCompSize = readU32(view, e.localOffset + 18);
        const lhNameLen = readU16(view, e.localOffset + 26);
        const lhExtraLen = readU16(view, e.localOffset + 28);
        const dataStart = e.localOffset + 30 + lhNameLen + lhExtraLen;
        let dataEnd;
        if (lhCompSize > 0 && dataStart + lhCompSize <= bytes.length) {
          dataEnd = dataStart + lhCompSize;
        } else if (e.compSize && dataStart + e.compSize <= bytes.length) {
          dataEnd = dataStart + e.compSize;
        } else if (tolerant) {
          dataEnd = findNextSignature(bytes, dataStart);
        } else {
          log.warn(`Skipping ${e.name}: compressed size unknown.`);
          continue;
        }
        if (dataEnd <= dataStart || dataEnd > bytes.length) {
          log.warn(`Skipping ${e.name}: invalid data range.`);
          continue;
        }
        const raw = bytes.slice(dataStart, dataEnd);
        let data;
        if (lhMethod === 0) {
          data = raw;
        } else if (lhMethod === 8) {
          // Immortal Inflater tolerates trailing data-descriptor bytes and
          // corrupt/truncated streams, returning partial output rather than
          // throwing — so no trim-and-retry loop is needed.
          const res = inflateImmortal(raw);
          data = res.data;
          if (res.isCorrupt) {
            log.warn(`${e.name}: DEFLATE stream corrupt — recovered ${data.length} bytes (partial).`);
          }
          if (!data || data.length === 0) {
            log.err(`Failed to decompress ${e.name}.`);
            continue;
          }
        } else {
          log.warn(`Skipping ${e.name}: unsupported method ${lhMethod}.`);
          continue;
        }
        if (e.name.endsWith('/')) continue;
        out[e.name] = data;
        log.ok(`Extracted ${e.name} (${data.length} bytes)`);
      } catch (err) {
        log.err(`${e.name}: ${err.message}`);
      }
    }
    return out;
  }

  function findNextSignature(bytes, from) {
    for (let i = from; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0x50 && bytes[i+1] === 0x4B &&
          ((bytes[i+2] === 0x03 && bytes[i+3] === 0x04) ||
           (bytes[i+2] === 0x01 && bytes[i+3] === 0x02) ||
           (bytes[i+2] === 0x05 && bytes[i+3] === 0x06) ||
           (bytes[i+2] === 0x07 && bytes[i+3] === 0x08))) {
        return i;
      }
    }
    return bytes.length;
  }

  // ---------- Strategy 3: XML repair ----------

  function repairXml(text, log, path) {
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    let toCheck = cleaned;

    const lastGt = toCheck.lastIndexOf('>');
    if (lastGt < toCheck.length - 1 && lastGt >= 0) {
      toCheck = toCheck.slice(0, lastGt + 1);
    }

    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(toCheck, 'application/xml');
        const err = doc.querySelector('parsererror');
        if (!err) return toCheck;
      } catch (_) {}
    }

    const tags = [];
    const re = /<\s*(\/?)\s*([A-Za-z_][\w:.\-]*)\b[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(toCheck))) {
      const isClose = m[1] === '/';
      const tag = m[2];
      const isSelf = m[3] === '/';
      if (isSelf) continue;
      if (isClose) {
        for (let i = tags.length - 1; i >= 0; i--) {
          if (tags[i] === tag) { tags.splice(i, 1); break; }
        }
      } else {
        tags.push(tag);
      }
    }
    while (tags.length) toCheck += `</${tags.pop()}>`;
    log.warn(`Repaired XML: ${path}`);
    return toCheck;
  }

  // ---------- Strategy 4: text rescue ----------

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }

  // Pull readable text out of an ODF content.xml. Paragraphs (<text:p>) and
  // headings (<text:h>) become individual lines; <text:tab>/<text:s>/line
  // breaks are converted to whitespace. Works for text, spreadsheet (each
  // cell is a text:p) and presentation documents alike.
  function extractOdfText(entries) {
    const contentNames = Object.keys(entries)
      .filter(p => /(^|\/)content\.xml$/i.test(p))
      .sort();
    const paragraphs = [];
    for (const name of contentNames) {
      const xml = new TextDecoder('utf-8', { fatal: false }).decode(entries[name]);
      const blockRe = /<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g;
      let m;
      while ((m = blockRe.exec(xml))) {
        let inner = m[2];
        // Tabs and explicit spaces.
        inner = inner.replace(/<text:tab\b[^>]*\/?>/g, '\t');
        inner = inner.replace(/<text:s\b[^>]*\/?>/g, ' ');
        inner = inner.replace(/<text:line-break\b[^>]*\/?>/g, '\n');
        // Strip every remaining tag, then decode entities.
        inner = inner.replace(/<[^>]+>/g, '');
        paragraphs.push(decodeEntities(inner));
      }
    }
    return paragraphs;
  }

  // ---------- Repackage ----------

  function dosTime(d) {
    return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  }

  // Build a fresh ODF zip. ODF mandates that the `mimetype` member is the
  // FIRST entry and is STORED (compression method 0) with no extra field, so
  // the type can be sniffed from the first bytes of the archive.
  async function buildZip(entries, mimeString) {
    const now = new Date();
    const time = dosTime(now), date = dosDate(now);
    const enc = new TextEncoder();
    const localChunks = [];
    const cdChunks = [];
    let offset = 0;

    // Guarantee a correct mimetype member.
    const work = Object.assign({}, entries);
    if (mimeString) work['mimetype'] = enc.encode(mimeString);

    let names = Object.keys(work).filter(n => n !== 'mimetype').sort();
    if (work['mimetype'] !== undefined) names.unshift('mimetype');

    for (const name of names) {
      const raw = work[name];
      const nameBytes = enc.encode(name);
      const forceStore = (name === 'mimetype');
      const compressed = forceStore ? raw : await deflateRaw(raw);
      const useStored = forceStore || !compressed || compressed.length >= raw.length;
      const data = useStored ? raw : compressed;
      const method = useStored ? 0 : 8;
      const crc = crc32(raw);

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, SIG_LFH, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localChunks.push(lh, data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, SIG_CDH, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      cdChunks.push(ch);

      offset += lh.length + data.length;
    }

    const cdSize = cdChunks.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, SIG_EOCD, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, names.length, true);
    ev.setUint16(10, names.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localChunks, ...cdChunks, eocd], {
      type: mimeString || 'application/octet-stream'
    });
  }

  function extFromName(name) {
    const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  // ---------- Pipeline ----------

  async function recover(file, log) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    log.info(`Loaded "${file.name}" (${bytes.length.toLocaleString()} bytes)`);

    let entries = null;
    let strategy = 'standard';
    try {
      entries = await parseStandard(bytes, log);
    } catch (err) {
      log.err(`Standard parse failed: ${err.message}`);
    }
    if (!entries || Object.keys(entries).length === 0) {
      strategy = 'low-level scan';
      try {
        entries = await parseScan(bytes, log);
      } catch (err) {
        log.err(`Scan failed: ${err.message}`);
        entries = {};
      }
    }

    let xmlRepaired = 0;
    for (const [path, data] of Object.entries(entries)) {
      if (/\.xml$/i.test(path)) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
        const repaired = repairXml(text, { warn: () => {}, info: () => {}, ok: () => {}, err: () => {} }, path);
        if (repaired !== text) xmlRepaired++;
        entries[path] = new TextEncoder().encode(repaired);
      }
    }
    if (xmlRepaired) log.warn(`Repaired ${xmlRepaired} XML entr${xmlRepaired === 1 ? 'y' : 'ies'}.`);

    // Determine the document mimetype: prefer the recovered `mimetype`
    // member, then fall back to the original file extension.
    let mimeString = '';
    if (entries['mimetype']) {
      mimeString = new TextDecoder('utf-8', { fatal: false }).decode(entries['mimetype']).trim();
    }
    const ext = extFromName(file.name);
    if (!mimeString && ODF_MIME[ext]) mimeString = ODF_MIME[ext];
    if (!mimeString) mimeString = ODF_MIME.odt;

    const paragraphs = extractOdfText(entries);
    log.info(`Extracted ${paragraphs.length} paragraph(s) of text.`);

    const recoveredBlob = await buildZip(entries, mimeString);
    const textDump = paragraphs.length
      ? paragraphs.join('\n')
      : '(No document text recovered.)';

    return {
      recovered: recoveredBlob,
      textDump: new Blob([textDump], { type: 'text/plain' }),
      entriesCount: Object.keys(entries).length,
      paragraphsCount: paragraphs.length,
      mimeString,
      ext: ext || 'odt',
      strategy
    };
  }

  // ---------- UI wiring ----------

  const $ = (id) => document.getElementById(id);

  function makeLog() {
    const el = $('log');
    const wrap = $('log-wrap');
    const push = (cls, msg) => {
      wrap.classList.remove('hidden');
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    };
    return {
      ok: (m) => push('ok', '✓ ' + m),
      warn: (m) => push('warn', '! ' + m),
      err: (m) => push('err', '✗ ' + m),
      info: (m) => push('info', '· ' + m),
      clear: () => { el.innerHTML = ''; wrap.classList.add('hidden'); wrap.open = false; }
    };
  }

  function setStatus(msg, kind) {
    const s = $('status');
    s.classList.remove('hidden', 'error', 'success');
    if (kind) s.classList.add(kind);
    s.textContent = msg;
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function ready() {
    if (!_Inflate) {
      setStatus('Could not load the Immortal Inflater (immortal-inflate.js). Please reload the page.', 'error');
      $('drop').style.pointerEvents = 'none';
      $('drop').style.opacity = '0.5';
      return;
    }

    const drop = $('drop');
    const fileInput = $('file');
    let lastResult = null;
    let baseName = 'recovered';
    const log = makeLog();

    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handle(f);
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) handle(f);
    });

    $('reset').addEventListener('click', () => {
      fileInput.value = '';
      lastResult = null;
      $('meta').classList.add('hidden');
      $('actions').classList.add('hidden');
      $('status').classList.add('hidden');
      log.clear();
    });

    $('dl-odf').addEventListener('click', () => {
      if (lastResult) downloadBlob(lastResult.recovered, baseName + '.recovered.' + lastResult.ext);
    });
    $('dl-text').addEventListener('click', () => {
      if (lastResult) downloadBlob(lastResult.textDump, baseName + '.txt');
    });

    async function handle(file) {
      log.clear();
      setStatus(`Recovering "${file.name}"…`);
      $('meta').classList.add('hidden');
      $('actions').classList.add('hidden');
      baseName = (file.name || 'recovered').replace(/\.[^.]+$/i, '') || 'recovered';
      try {
        const result = await recover(file, log);
        lastResult = result;
        $('m-input').textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
        $('m-entries').textContent = String(result.entriesCount);
        $('m-paras').textContent = String(result.paragraphsCount);
        $('m-strategy').textContent = result.strategy;
        $('meta').classList.remove('hidden');
        $('actions').classList.remove('hidden');
        $('dl-odf').disabled = result.entriesCount === 0;
        $('dl-text').disabled = result.paragraphsCount === 0;
        if (result.entriesCount === 0) {
          setStatus('Could not recover any entries from this file.', 'error');
        } else {
          setStatus(`Recovered ${result.entriesCount} entries and ${result.paragraphsCount} paragraphs.`, 'success');
        }
      } catch (err) {
        console.error(err);
        log.err(err.stack || err.message);
        setStatus('Recovery failed: ' + err.message, 'error');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
