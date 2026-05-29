/**
 * immortal-inflate.js — Immortal Inflater: Fault-Tolerant DEFLATE Decoder
 *
 * Ported from the Universal File Repair Tool (https://github.com/socrtwo/Universal-File-Repair-Tool)
 * Decodes DEFLATE-compressed data even when the stream is corrupt or truncated.
 *
 * UMD module — works in browsers (global), CommonJS (Node.js), and AMD environments.
 *
 * Usage (browser):
 *   <script src="immortal-inflate.js"></script>
 *   const result = ImmortalInflate(compressedUint8Array);
 *   // result.data      — Uint8Array of decompressed bytes
 *   // result.isCorrupt — boolean, true if stream had errors but partial data was recovered
 *
 * Usage (Node.js / CommonJS):
 *   const ImmortalInflate = require('./immortal-inflate');
 *   const result = ImmortalInflate(compressedUint8Array);
 *
 * Usage (ES module):
 *   import ImmortalInflate from './immortal-inflate.js';
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ImmortalInflate = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

    // =========================================================================
    // IMMORTAL INFLATER (Fault-Tolerant DEFLATE Decoder)
    // =========================================================================

    class BitStream {
        constructor(u8) { this.buf = u8; this.pos = 0; this.bit = 0; this.len = u8.length; }
        read(n) {
            let v = 0;
            for (let i = 0; i < n; i++) {
                if (this.pos >= this.len) return -1;
                v |= ((this.buf[this.pos] >>> this.bit) & 1) << i;
                this.bit++;
                if (this.bit === 8) { this.bit = 0; this.pos++; }
            }
            return v;
        }
        align() { if (this.bit !== 0) { this.bit = 0; this.pos++; } }
    }

    const FIXED_LIT = new Uint8Array(288);
    for (let i = 0; i < 144; i++) FIXED_LIT[i] = 8;
    for (let i = 144; i < 256; i++) FIXED_LIT[i] = 9;
    for (let i = 256; i < 280; i++) FIXED_LIT[i] = 7;
    for (let i = 280; i < 288; i++) FIXED_LIT[i] = 8;

    const FIXED_DIST = new Uint8Array(32);
    for (let i = 0; i < 32; i++) FIXED_DIST[i] = 5;

    const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const LEN_BASE   = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LEN_EXTRA  = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DIST_BASE  = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

    function buildTree(lengths) {
        const counts = new Int32Array(16), nextCode = new Int32Array(16);
        let maxLen = 0;
        for (let i = 0; i < lengths.length; i++) {
            counts[lengths[i]]++;
            if (lengths[i] > maxLen) maxLen = lengths[i];
        }
        if (maxLen === 0) return null;
        let code = 0; counts[0] = 0;
        for (let i = 1; i <= 15; i++) { code = (code + counts[i - 1]) << 1; nextCode[i] = code; }
        const map = {};
        for (let i = 0; i < lengths.length; i++) {
            const len = lengths[i];
            if (len !== 0) { map[(len << 16) | nextCode[len]] = i; nextCode[len]++; }
        }
        return { map, maxLen };
    }

    function decodeSym(s, t) {
        let c = 0;
        for (let l = 1; l <= t.maxLen; l++) {
            const b = s.read(1); if (b === -1) return -1;
            c = (c << 1) | b;
            const k = (l << 16) | c;
            if (t.map[k] !== undefined) return t.map[k];
        }
        return -2;
    }

    /**
     * Decompress a raw DEFLATE stream (no zlib/gzip wrapper).
     *
     * @param {Uint8Array} u8 — compressed bytes
     * @returns {{ data: Uint8Array, isCorrupt: boolean }}
     */
    return function ImmortalInflate(u8) {
        const s = new BitStream(u8);
        const out = [];
        let bfinal = 0;
        let corrupted = false;
        try {
            while (!bfinal) {
                bfinal = s.read(1);
                const btype = s.read(2);
                if (bfinal === -1 || btype === -1) { corrupted = true; break; }

                if (btype === 0) {
                    // Stored (uncompressed) block
                    s.align();
                    const len = s.read(16);
                    s.read(16); // nlen (one's complement check — ignored in repair mode)
                    if (len === -1) { corrupted = true; break; }
                    for (let i = 0; i < len; i++) out.push(s.buf[s.pos++] || 0);

                } else if (btype === 1 || btype === 2) {
                    let lt, dt;
                    if (btype === 1) {
                        lt = buildTree(FIXED_LIT);
                        dt = buildTree(FIXED_DIST);
                    } else {
                        const hl = s.read(5) + 257, hd = s.read(5) + 1, hc = s.read(4) + 4;
                        if (hl < 257) { corrupted = true; break; }
                        const cl = new Uint8Array(19);
                        for (let i = 0; i < hc; i++) cl[CLEN_ORDER[i]] = s.read(3);
                        const ct = buildTree(cl); if (!ct) { corrupted = true; break; }
                        const unpack = (count) => {
                            const r = [];
                            while (r.length < count) {
                                const sy = decodeSym(s, ct);
                                if (sy < 0 || sy > 18) return null;
                                if (sy < 16) r.push(sy);
                                else if (sy === 16) { let c = 3 + s.read(2), p = r[r.length - 1]; while (c--) r.push(p); }
                                else if (sy === 17) { let z = 3 + s.read(3); while (z--) r.push(0); }
                                else if (sy === 18) { let z = 11 + s.read(7); while (z--) r.push(0); }
                            }
                            return new Uint8Array(r);
                        };
                        const ll = unpack(hl), dl = unpack(hd);
                        if (!ll || !dl) { corrupted = true; break; }
                        lt = buildTree(ll);
                        dt = buildTree(dl);
                    }
                    if (!lt || !dt) { corrupted = true; break; }
                    while (true) {
                        const sym = decodeSym(s, lt);
                        if (sym === -1 || sym === -2) { corrupted = true; break; }
                        if (sym === 256) break;
                        if (sym < 256) {
                            out.push(sym);
                        } else {
                            const lc = sym - 257; if (lc > 28) { corrupted = true; break; }
                            const len = LEN_BASE[lc] + s.read(LEN_EXTRA[lc]);
                            const dc = decodeSym(s, dt); if (dc < 0) { corrupted = true; break; }
                            const dist = DIST_BASE[dc] + s.read(DIST_EXTRA[dc]);
                            if (dist > out.length) { corrupted = true; bfinal = 1; break; }
                            let ptr = out.length - dist;
                            for (let i = 0; i < len; i++) out.push(out[ptr++]);
                        }
                    }
                } else {
                    corrupted = true; break;
                }
            }
        } catch (e) {
            corrupted = true;
        }
        return { data: new Uint8Array(out), isCorrupt: corrupted };
    };

}));
