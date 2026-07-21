/*!
 * S2 File Identifier — shared first-step module for the S2 recovery tool suite.
 *
 * Before any repair runs, this module:
 *   1. Reads the file's magic numbers and identifies what kind of file it is.
 *   2. Scans the whole buffer for additional embedded / concatenated files
 *      (e.g. a PDF glued onto a DOCX, two files fused by a disk error).
 *   3. Separates the pieces, offers every "foreign" piece for download, and
 *      recommends which S2 program repairs that kind of file — before the
 *      host program tries to fix whatever is left over.
 *
 * 100% client-side: nothing is uploaded anywhere.
 * Works as a browser global (window.S2FileID) and as a CommonJS module.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Program registry — the S2 tool suite and what each program handles *
   * ------------------------------------------------------------------ */

  var PROGRAMS = [
    { key: 'universal',        name: 'Universal File Repair Tool',               url: 'https://socrtwo.github.io/Universal-File-Repair-Tool/', handles: ['*'] },
    { key: 'corruptdocxrepair',name: 'CorruptDOCXRepair',                        url: 'https://socrtwo.github.io/CorruptDOCXRepair/',          handles: ['docx'] },
    { key: 'quickwordrecovr',  name: 'Quick Word Recovr',                        url: 'https://socrtwo.github.io/quickwordrecovr-SF/',         handles: ['docx'] },
    { key: 'wordrecovery',     name: 'Word Recovery',                            url: 'https://socrtwo.github.io/wordrecovery-SF/',            handles: ['doc', 'docx'] },
    { key: 'damageddocx2txt',  name: 'Damageddocx2txt',                          url: 'https://socrtwo.github.io/damageddocx2txt-SF/',         handles: ['docx'] },
    { key: 'corruptexcelrec',  name: 'S2 Recovery Tools for Microsoft Excel',    url: 'https://socrtwo.github.io/corruptexcelrec-SF/',         handles: ['xls', 'xlsx'] },
    { key: 'excelrcvryaddin',  name: 'Excel Recovery Addin',                     url: 'https://socrtwo.github.io/excelrcvryaddin-SF/',         handles: ['xls'] },
    { key: 'pptxrecovery',     name: 'PPTX Recovery',                            url: 'https://socrtwo.github.io/pptxrecovery-SF/',            handles: ['pptx'] },
    { key: 'oorecovery',       name: 'OO Recovery (OpenDocument)',               url: 'https://socrtwo.github.io/oorecovery-SF/',              handles: ['odt', 'ods', 'odp', 'odg'] },
    { key: 'immortalzip',      name: 'Immortal Zip',                             url: 'https://socrtwo.github.io/Immortal-Zip/',               handles: ['zip', 'jar', 'apk', 'epub'] },
    { key: 'xmltrncatorfixr',  name: 'XML Truncator-Fixer',                      url: 'https://socrtwo.github.io/xmltrncatorfixr-SF/app/',     handles: ['xml', 'docx', 'xlsx', 'pptx'] },
    { key: 'savvyoffice',      name: 'Savvy Repair for Microsoft Office',        url: 'https://socrtwo.github.io/savvyoffice-SF/',             handles: ['doc', 'xls', 'ppt', 'docx', 'xlsx', 'pptx'] },
    { key: 'coffice2txt',      name: 'Coffice2txt',                              url: 'https://socrtwo.github.io/coffice2txt-SF/',             handles: ['doc', 'xls', 'ppt', 'docx', 'xlsx', 'pptx'] },
    { key: 'crrptoffcxtrctr',  name: 'Crrptoffcxtrctr (Office extractor)',       url: 'https://socrtwo.github.io/crrptoffcxtrctr-SF/',         handles: ['docx', 'xlsx', 'pptx'] },
    { key: 'saveofficedata',   name: 'Saveofficedata',                           url: 'https://socrtwo.github.io/saveofficedata-SF/',          handles: ['doc', 'xls', 'ppt'] },
    { key: 'filefixerbot',     name: 'File Fixer Bot',                           url: 'https://socrtwo.github.io/file-fixer-bot/',             handles: ['*'] },
    { key: 'datarecoverfree',  name: 'Datarecoverfree',                          url: 'https://socrtwo.github.io/datarecoverfree-SF/',         handles: [] },
    { key: 'vistaprevrsrcvr',  name: 'Previous Version Explorer',                url: 'https://socrtwo.github.io/vistaprevrsrcvr-SF/',         handles: [] }
  ];

  /* Preferred repair order per detected extension (best tool first). */
  var RECOMMEND_ORDER = {
    docx: ['corruptdocxrepair', 'quickwordrecovr', 'wordrecovery', 'xmltrncatorfixr', 'savvyoffice', 'crrptoffcxtrctr', 'damageddocx2txt', 'coffice2txt'],
    doc:  ['wordrecovery', 'savvyoffice', 'coffice2txt', 'saveofficedata'],
    xls:  ['corruptexcelrec', 'savvyoffice', 'excelrcvryaddin', 'coffice2txt', 'saveofficedata'],
    xlsx: ['corruptexcelrec', 'xmltrncatorfixr', 'savvyoffice', 'crrptoffcxtrctr', 'coffice2txt'],
    ppt:  ['savvyoffice', 'coffice2txt', 'saveofficedata'],
    pptx: ['pptxrecovery', 'xmltrncatorfixr', 'savvyoffice', 'crrptoffcxtrctr', 'coffice2txt'],
    odt:  ['oorecovery'], ods: ['oorecovery'], odp: ['oorecovery'], odg: ['oorecovery'],
    zip:  ['immortalzip'], jar: ['immortalzip'], apk: ['immortalzip'], epub: ['immortalzip'],
    xml:  ['xmltrncatorfixr']
  };

  function programByKey(key) {
    for (var i = 0; i < PROGRAMS.length; i++) if (PROGRAMS[i].key === key) return PROGRAMS[i];
    return null;
  }

  /* Ordered list of suite programs that can repair `ext`, excluding the
     program identified by excludeKey. Falls back to the universal tool. */
  function recommend(ext, excludeKey) {
    var keys = RECOMMEND_ORDER[ext] || [];
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === excludeKey) continue;
      var p = programByKey(keys[i]);
      if (p) out.push(p);
    }
    if (!out.length && excludeKey !== 'universal') out.push(programByKey('universal'));
    return out;
  }

  function programHandles(programKey, ext) {
    var p = programByKey(programKey);
    if (!p) return false;
    if (p.handles.indexOf('*') !== -1) return true;
    return p.handles.indexOf(ext) !== -1;
  }

  /* --------------------------- byte helpers --------------------------- */

  function toU8(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    throw new Error('S2FileID: expected Uint8Array or ArrayBuffer');
  }

  function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function matches(b, off, sig) {
    if (off + sig.length > b.length) return false;
    for (var i = 0; i < sig.length; i++) if (b[off + i] !== sig[i]) return false;
    return true;
  }

  function ascii(str) {
    var a = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xff;
    return a;
  }

  /* Find every occurrence of a byte pattern. */
  function findAll(b, sig, start, end) {
    var hits = [];
    var last = (end === undefined ? b.length : end) - sig.length;
    for (var i = start || 0; i <= last; i++) {
      if (b[i] === sig[0] && matches(b, i, sig)) hits.push(i);
    }
    return hits;
  }

  function indexOfBytes(b, sig, start, end) {
    var last = (end === undefined ? b.length : end) - sig.length;
    for (var i = start || 0; i <= last; i++) {
      if (b[i] === sig[0] && matches(b, i, sig)) return i;
    }
    return -1;
  }

  /* UTF-16LE encode an ASCII string (for OLE2 directory entry names). */
  function utf16le(str) {
    var a = new Uint8Array(str.length * 2);
    for (var i = 0; i < str.length; i++) { a[i * 2] = str.charCodeAt(i) & 0xff; a[i * 2 + 1] = 0; }
    return a;
  }

  /* ----------------------- signature definitions ----------------------- */

  var SIG = {
    ZIP_LOCAL:  [0x50, 0x4b, 0x03, 0x04],
    ZIP_EOCD:   [0x50, 0x4b, 0x05, 0x06],
    ZIP_CDIR:   [0x50, 0x4b, 0x01, 0x02],
    ZIP_SPAN:   [0x50, 0x4b, 0x07, 0x08],
    OLE2:       [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    PDF:        [0x25, 0x50, 0x44, 0x46, 0x2d],                   // %PDF-
    PNG:        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    GIF87:      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    GIF89:      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    JPEG:       [0xff, 0xd8, 0xff],
    RTF:        [0x7b, 0x5c, 0x72, 0x74, 0x66],                   // {\rtf
    SEVENZ:     [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    RAR:        [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    GZIP:       [0x1f, 0x8b, 0x08],
    XMLDECL:    [0x3c, 0x3f, 0x78, 0x6d, 0x6c],                   // <?xml
    TIFF_LE:    [0x49, 0x49, 0x2a, 0x00],
    TIFF_BE:    [0x4d, 0x4d, 0x00, 0x2a],
    SQLITE:     [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66], // "SQLite f"
    RIFF:       [0x52, 0x49, 0x46, 0x46],
    OGG:        [0x4f, 0x67, 0x67, 0x53],
    FLAC:       [0x66, 0x4c, 0x61, 0x43],
    ID3:        [0x49, 0x44, 0x33],
    PST:        [0x21, 0x42, 0x44, 0x4e]                          // !BDN
  };

  var DESCRIPTIONS = {
    docx: 'Microsoft Word document (DOCX, Office Open XML)',
    xlsx: 'Microsoft Excel workbook (XLSX, Office Open XML)',
    pptx: 'Microsoft PowerPoint presentation (PPTX, Office Open XML)',
    ooxml:'Microsoft Office Open XML document (type unclear)',
    doc:  'Microsoft Word 97-2003 document (DOC)',
    xls:  'Microsoft Excel 97-2003 workbook (XLS)',
    ppt:  'Microsoft PowerPoint 97-2003 presentation (PPT)',
    msg:  'Microsoft Outlook message (MSG)',
    vsd:  'Microsoft Visio drawing (VSD)',
    ole:  'Microsoft Office compound (OLE2) file — exact type unclear',
    odt:  'OpenDocument text (ODT)',
    ods:  'OpenDocument spreadsheet (ODS)',
    odp:  'OpenDocument presentation (ODP)',
    odg:  'OpenDocument drawing (ODG)',
    epub: 'EPUB e-book',
    jar:  'Java archive (JAR)',
    apk:  'Android package (APK)',
    zip:  'ZIP archive',
    pdf:  'PDF document',
    png:  'PNG image',
    gif:  'GIF image',
    jpg:  'JPEG image',
    tif:  'TIFF image',
    bmp:  'BMP image',
    rtf:  'Rich Text Format document (RTF)',
    '7z': '7-Zip archive',
    rar:  'RAR archive',
    gz:   'GZIP compressed data',
    xml:  'XML document',
    html: 'HTML document',
    sqlite:'SQLite database',
    pst:  'Outlook data file (PST/OST)',
    wav:  'WAV audio', avi: 'AVI video', webp: 'WebP image',
    ogg:  'OGG media', flac: 'FLAC audio', mp3: 'MP3 audio',
    mp4:  'MP4 / QuickTime media',
    exe:  'Windows executable (EXE/DLL)',
    txt:  'Plain text',
    csv:  'Comma-separated values (CSV)',
    bin:  'Unrecognized binary data'
  };

  /* ------------------------- ZIP refinement ------------------------- */

  /* Distinguish DOCX / XLSX / PPTX / ODF / EPUB / JAR / APK / plain ZIP.
     Uses raw byte search for well-known entry names — this keeps working
     when the archive structure itself is corrupt, because entry names are
     stored uncompressed in local headers and the central directory. */
  function refineZip(b, start, end) {
    function has(s) { return indexOfBytes(b, ascii(s), start, end) !== -1; }
    if (has('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
    if (has('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return 'ods';
    if (has('mimetypeapplication/vnd.oasis.opendocument.presentation')) return 'odp';
    if (has('mimetypeapplication/vnd.oasis.opendocument.graphics')) return 'odg';
    if (has('mimetypeapplication/epub+zip')) return 'epub';
    var isOoxml = has('[Content_Types].xml');
    if (has('word/document.xml') || has('word/_rels/')) return 'docx';
    if (has('xl/workbook.xml') || has('xl/_rels/')) return 'xlsx';
    if (has('ppt/presentation.xml') || has('ppt/slides/')) return 'pptx';
    if (isOoxml) return 'ooxml';
    if (has('AndroidManifest.xml')) return 'apk';
    if (has('META-INF/MANIFEST.MF')) return 'jar';
    // ODF whose mimetype entry was compressed or lost:
    if (has('content.xml') && has('META-INF/manifest.xml')) {
      if (has('office:spreadsheet')) return 'ods';
      if (has('office:presentation')) return 'odp';
      return 'odt';
    }
    return 'zip';
  }

  /* Best-effort walk of ZIP local file headers starting at `start`.
     Returns { end, clean } where `end` is the last offset proven to be
     inside this archive's entry data (so signature hits below it are
     internal, not a second file) and `clean` says the walk never broke. */
  function walkZipEntries(b, start) {
    var pos = start;
    // Everything up to `verified` is proven to belong to this archive:
    // each size-based jump that lands on another PK header confirms the
    // previous entry's declared size was right. The final entry's data is
    // only confirmed once the walk reaches the central directory / EOCD.
    var verified = start;
    while (pos + 30 <= b.length && matches(b, pos, SIG.ZIP_LOCAL)) {
      verified = pos;
      var flags = u16le(b, pos + 6);
      var csize = u32le(b, pos + 18);
      var nameLen = u16le(b, pos + 26);
      var extraLen = u16le(b, pos + 28);
      var dataStart = pos + 30 + nameLen + extraLen;
      if (nameLen === 0 || dataStart > b.length) break;
      verified = dataStart;
      if (flags & 0x08) {
        // Data descriptor: sizes unknown up front — find the next
        // descriptor signature; if absent the walk cannot continue.
        var dd = indexOfBytes(b, SIG.ZIP_SPAN, dataStart);
        if (dd === -1) { pos = dataStart; break; }
        pos = dd + 16;
      } else {
        var next = dataStart + csize;
        if (next > b.length) { pos = dataStart; break; }
        pos = next;
      }
    }
    // Central directory + EOCD follow the entries.
    if (matches(b, pos, SIG.ZIP_CDIR)) verified = pos;
    while (pos + 46 <= b.length && matches(b, pos, SIG.ZIP_CDIR)) {
      var cn = u16le(b, pos + 28), ce = u16le(b, pos + 30), cc = u16le(b, pos + 32);
      pos = pos + 46 + cn + ce + cc;
    }
    if (pos + 22 <= b.length && matches(b, pos, SIG.ZIP_EOCD)) {
      var comment = u16le(b, pos + 20);
      return { end: Math.min(pos + 22 + comment, b.length), clean: true };
    }
    // No EOCD: the archive is corrupt or truncated. Trust only the
    // verified prefix, so appended foreign files are still found even when
    // a truncated entry's declared size would have swallowed them.
    return { end: Math.min(verified, b.length), clean: false };
  }

  /* ------------------------- OLE2 refinement ------------------------- */

  function refineOle(b, start, end) {
    function has16(s) { return indexOfBytes(b, utf16le(s), start, end) !== -1; }
    if (has16('WordDocument')) return 'doc';
    if (has16('Workbook') || has16('Book')) return 'xls';
    if (has16('PowerPoint Document')) return 'ppt';
    if (has16('VisioDocument')) return 'vsd';
    if (has16('__properties_version1.0') || has16('__recip_version1.0')) return 'msg';
    return 'ole';
  }

  /* --------------------------- identification --------------------------- */

  function looksLikeText(b, start, end) {
    var n = Math.min(end - start, 4096);
    if (n === 0) return false;
    var printable = 0;
    for (var i = 0; i < n; i++) {
      var c = b[start + i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128) printable++;
      else if (c === 0) return false;
    }
    return printable / n > 0.95;
  }

  /* Identify the file that starts at `start` (default 0). */
  function identifyAt(b, start, end) {
    b = toU8(b);
    start = start || 0;
    end = end === undefined ? b.length : end;
    var res = function (ext, confidence) {
      return { ext: ext, description: DESCRIPTIONS[ext] || ext, confidence: confidence || 'high' };
    };

    if (matches(b, start, SIG.ZIP_LOCAL) || matches(b, start, SIG.ZIP_EOCD)) return res(refineZip(b, start, end));
    if (matches(b, start, SIG.OLE2)) return res(refineOle(b, start, end));
    if (matches(b, start, SIG.PDF)) return res('pdf');
    if (matches(b, start, SIG.PNG)) return res('png');
    if (matches(b, start, SIG.GIF87) || matches(b, start, SIG.GIF89)) return res('gif');
    if (matches(b, start, SIG.JPEG)) return res('jpg');
    if (matches(b, start, SIG.RTF)) return res('rtf');
    if (matches(b, start, SIG.SEVENZ)) return res('7z');
    if (matches(b, start, SIG.RAR)) return res('rar');
    if (matches(b, start, SIG.GZIP)) return res('gz');
    if (matches(b, start, SIG.SQLITE)) return res('sqlite');
    if (matches(b, start, SIG.PST)) return res('pst');
    if (matches(b, start, SIG.TIFF_LE) || matches(b, start, SIG.TIFF_BE)) return res('tif');
    if (matches(b, start, SIG.OGG)) return res('ogg');
    if (matches(b, start, SIG.FLAC)) return res('flac');
    if (matches(b, start, SIG.ID3)) return res('mp3', 'medium');
    if (matches(b, start, SIG.RIFF)) {
      if (matches(b, start + 8, ascii('WAVE'))) return res('wav');
      if (matches(b, start + 8, ascii('AVI '))) return res('avi');
      if (matches(b, start + 8, ascii('WEBP'))) return res('webp');
      return res('bin', 'low');
    }
    if (matches(b, start + 4, ascii('ftyp'))) return res('mp4');
    if (b[start] === 0x4d && b[start + 1] === 0x5a) return res('exe', 'medium');
    if (b[start] === 0x42 && b[start + 1] === 0x4d && start === 0) return res('bmp', 'medium');
    if (matches(b, start, SIG.XMLDECL)) {
      // <?xml ... — could be plain XML or a Flat ODF / saved OOXML part.
      return res('xml');
    }
    if (looksLikeText(b, start, end)) {
      var head = '';
      for (var i = start; i < Math.min(end, start + 512); i++) head += String.fromCharCode(b[i]);
      var lower = head.toLowerCase();
      if (lower.indexOf('<!doctype html') !== -1 || lower.indexOf('<html') !== -1) return res('html');
      if (lower.indexOf('<?xml') !== -1 || /^\s*</.test(head)) return res('xml', 'medium');
      return res('txt', 'medium');
    }
    return res('bin', 'low');
  }

  function identify(bytes) { return identifyAt(toU8(bytes), 0); }

  /* ------------------- embedded / concatenated file scan ------------------- */

  /* Signatures strong enough to mark the start of a NEW file mid-buffer.
     minRun guards against random matches in compressed data. */
  var BOUNDARY_SIGS = [
    { ext: 'zip', sig: SIG.ZIP_LOCAL },
    { ext: 'ole', sig: SIG.OLE2 },
    { ext: 'pdf', sig: SIG.PDF },
    { ext: 'png', sig: SIG.PNG },
    { ext: 'gif', sig: SIG.GIF87 }, { ext: 'gif', sig: SIG.GIF89 },
    // JPEG start-of-image plus a plausible first marker (4 bytes) — the bare
    // 3-byte SOI is too easy to hit inside compressed data.
    { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xe0] }, { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xe1] },
    { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xdb] }, { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xee] },
    { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xc0] }, { ext: 'jpg', sig: [0xff, 0xd8, 0xff, 0xe2] },
    { ext: 'rtf', sig: SIG.RTF },
    { ext: '7z',  sig: SIG.SEVENZ },
    { ext: 'rar', sig: SIG.RAR },
    { ext: 'sqlite', sig: SIG.SQLITE },
    { ext: 'pst', sig: SIG.PST }
  ];

  /* Per-segment scan state: how far the file starting at `start` provably
     extends (`guard`), and which acceptance rules apply inside it. */
  function segState(b, start) {
    if (matches(b, start, SIG.ZIP_LOCAL)) {
      var w = walkZipEntries(b, start);
      return { start: start, kind: 'zip', walkClean: w.clean, guard: Math.max(start + 4, w.end) };
    }
    if (matches(b, start, SIG.OLE2)) return { start: start, kind: 'ole', guard: start + 512 };
    if (matches(b, start, SIG.JPEG)) return { start: start, kind: 'jpg', guard: start + 4 };
    return { start: start, kind: 'other', guard: start + 1 };
  }

  /* Scan the buffer and split it into segments, one per distinct file.
     Heuristic by design: it never destroys data — segments are offered as
     extra downloads, and segment 0 is always the file the host program
     was asked to repair. */
  function scan(bytes) {
    var b = toU8(bytes);
    var segStarts = [0];
    var cur = segState(b, 0);
    var pos = Math.max(1, cur.guard);

    while (pos < b.length) {
      var hit = null;
      for (var s = 0; s < BOUNDARY_SIGS.length && !hit; s++) {
        if (matches(b, pos, BOUNDARY_SIGS[s].sig)) hit = BOUNDARY_SIGS[s];
      }
      if (hit) {
        var accept = true;
        if (cur.kind === 'zip') {
          if (hit.ext === 'zip') {
            // A PK header inside a zip we could not walk cleanly is almost
            // always a member of the SAME corrupt archive, not a new file.
            accept = cur.walkClean;
          } else {
            // Inside a corrupt zip, short signatures are likely deflate
            // noise; demand 5+ signature bytes.
            accept = cur.walkClean || hit.sig.length >= 5;
          }
        } else if (cur.kind === 'ole') {
          // A file concatenated after an OLE2 doc always lands on a
          // 512-byte boundary (OLE size is a multiple of 512).
          var aligned = ((pos - cur.start) % 512) === 0;
          accept = aligned || hit.sig.length >= 6;
        } else if (cur.kind === 'jpg' && hit.ext === 'jpg') {
          // Embedded EXIF thumbnails also start with SOI — only split if an
          // end-of-image marker was seen before this point.
          accept = indexOfBytes(b, [0xff, 0xd9], cur.start, pos) !== -1;
        }
        if (accept) {
          segStarts.push(pos);
          cur = segState(b, pos);
          pos = Math.max(pos + 1, cur.guard);
          continue;
        }
      }
      pos++;
    }

    var segments = [];
    for (var i = 0; i < segStarts.length; i++) {
      var start = segStarts[i];
      var end = i + 1 < segStarts.length ? segStarts[i + 1] : b.length;
      var info = identifyAt(b, start, end);
      segments.push({
        index: i,
        offset: start,
        length: end - start,
        ext: info.ext,
        description: info.description,
        confidence: info.confidence,
        bytes: b.subarray(start, end)
      });
    }
    return { segments: segments, multiple: segments.length > 1 };
  }

  /* ------------------------------ analyze ------------------------------ */

  /*
   * The one call host programs make first.
   *   report = S2FileID.analyze(bytes, { programKey: 'pptxrecovery', fileName: f.name })
   *
   * report.primary            — identification of the file as a whole
   * report.segments           — every separated piece (bytes included)
   * report.matching           — segments this program is meant to repair
   * report.foreign            — segments of a different kind, each with
   *                             .recommended (ordered S2 programs) and
   *                             .suggestedName for download
   * report.mismatch           — true when even the main piece is not a type
   *                             this program handles
   * report.proceedBytes       — bytes the host should run its repair on
   *                             (first matching segment, else segment 0)
   */
  function analyze(bytes, opts) {
    opts = opts || {};
    var programKey = opts.programKey || null;
    var fileName = opts.fileName || 'recovered-file';
    var base = fileName.replace(/\.[A-Za-z0-9]{1,6}$/, '');
    var b = toU8(bytes);
    var result = scan(b);
    var segments = result.segments;
    var matching = [], foreign = [];

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var handled = programKey ? programHandles(programKey, seg.ext) : true;
      seg.handledHere = handled;
      seg.suggestedName = segments.length > 1
        ? base + '.part' + (i + 1) + '.' + seg.ext
        : base + '.' + seg.ext;
      if (handled) matching.push(seg);
      else {
        seg.recommended = recommend(seg.ext, programKey);
        foreign.push(seg);
      }
    }

    var proceedSeg = matching.length ? matching[0] : segments[0];
    return {
      fileName: fileName,
      primary: { ext: segments[0].ext, description: segments[0].description, confidence: segments[0].confidence },
      segments: segments,
      matching: matching,
      foreign: foreign,
      multiple: result.multiple,
      mismatch: programKey ? !programHandles(programKey, segments[0].ext) : false,
      proceedBytes: proceedSeg ? proceedSeg.bytes : b,
      proceedSegment: proceedSeg
    };
  }

  /* ------------------------------ UI panel ------------------------------ */

  var MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    pdf: 'application/pdf', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg',
    zip: 'application/zip', xml: 'application/xml', txt: 'text/plain', html: 'text/html'
  };

  /*
   * Render the identification report into `container` (a DOM element).
   * Shows: what the file is, any separated foreign files with download
   * buttons and program recommendations. Returns the report untouched.
   */
  function renderPanel(container, report) {
    if (!container || typeof document === 'undefined') return report;
    container.innerHTML = '';

    var panel = document.createElement('div');
    panel.setAttribute('data-s2fileid', '1');
    panel.style.cssText = 'margin:12px 0;padding:12px 14px;border:1px solid rgba(128,128,128,.45);' +
      'border-radius:8px;font:14px/1.5 system-ui,sans-serif;text-align:left;';

    var head = document.createElement('div');
    head.innerHTML = '<strong>File identification (magic numbers):</strong> ' +
      escapeHtml(report.primary.description) +
      (report.primary.confidence !== 'high' ? ' <em>(confidence: ' + report.primary.confidence + ')</em>' : '');
    panel.appendChild(head);

    if (report.mismatch) {
      var warn = document.createElement('div');
      warn.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(255,165,0,.15);';
      var recs = recommend(report.primary.ext, null);
      warn.innerHTML = '&#9888;&#65039; This program is not designed to repair this kind of file.' +
        (recs.length ? ' Recommended tool: ' + linkHtml(recs[0]) : '');
      panel.appendChild(warn);
    }

    if (report.foreign.length) {
      var note = document.createElement('div');
      note.style.cssText = 'margin-top:8px;';
      note.innerHTML = '<strong>' + report.foreign.length + ' embedded/concatenated file(s) of a different type ' +
        'were found and separated.</strong> Download them below and repair each with the recommended program ' +
        '<em>before</em> continuing with the remaining data:';
      panel.appendChild(note);

      for (var i = 0; i < report.foreign.length; i++) {
        (function (seg) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;' +
            'padding:6px 8px;border:1px dashed rgba(128,128,128,.45);border-radius:6px;';
          var label = document.createElement('span');
          label.innerHTML = escapeHtml(seg.description) + ' — ' + fmtSize(seg.length) +
            ' at offset ' + seg.offset;
          row.appendChild(label);

          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'Download ' + seg.suggestedName;
          btn.style.cssText = 'padding:4px 10px;border-radius:6px;cursor:pointer;';
          btn.addEventListener('click', function () {
            var blob = new Blob([seg.bytes], { type: MIME[seg.ext] || 'application/octet-stream' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = seg.suggestedName;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          });
          row.appendChild(btn);

          if (seg.recommended && seg.recommended.length) {
            var rec = document.createElement('span');
            rec.innerHTML = 'Repair with: ' + linkHtml(seg.recommended[0]);
            row.appendChild(rec);
          }
          panel.appendChild(row);
        })(report.foreign[i]);
      }

      if (report.matching.length || report.segments.length > report.foreign.length) {
        var rest = document.createElement('div');
        rest.style.cssText = 'margin-top:8px;';
        rest.textContent = 'The remaining data will now be processed by this program.';
        panel.appendChild(rest);
      }
    }

    container.appendChild(panel);
    return report;
  }

  function linkHtml(p) {
    return '<a href="' + p.url + '" target="_blank" rel="noopener">' + escapeHtml(p.name) + '</a>';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  /* ------------------------------ exports ------------------------------ */

  var S2FileID = {
    PROGRAMS: PROGRAMS,
    identify: identify,
    identifyAt: identifyAt,
    scan: scan,
    analyze: analyze,
    recommend: recommend,
    programHandles: programHandles,
    renderPanel: renderPanel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S2FileID;
  global.S2FileID = S2FileID;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
