// Candidate encodings and the "can this encoding explain these bytes losslessly?"
// test.
//
// The test is a round trip, not a guess: decode, re-encode with the same codec,
// and compare bytes. If the bytes come back identical, the encoding explains the
// input with no substitution and no ambiguity. This is deterministic and costs
// two codec calls, which is why no sentinel-character hack (and no mutation of
// iconv-lite's global state) is needed.

import iconv from "../index-node.js"

// Encodings worth testing, grouped by the writing system they normally carry.
// `scripts` is used only to order the result list; it never decides the verdict.
export const CANDIDATES = [
  { encoding: "utf-8", label: "UTF-8", family: "unicode" },
  { encoding: "utf-16le", label: "UTF-16LE", family: "unicode" },
  { encoding: "utf-16be", label: "UTF-16BE", family: "unicode" },
  { encoding: "utf-32le", label: "UTF-32LE", family: "unicode" },
  { encoding: "utf-32be", label: "UTF-32BE", family: "unicode" },

  { encoding: "gb18030", label: "GB18030", family: "dbcs", scripts: ["cjk-simplified"] },
  { encoding: "big5", label: "Big5", family: "dbcs", scripts: ["cjk-traditional"] },
  { encoding: "shiftjis", label: "Shift_JIS", family: "dbcs", scripts: ["japanese"] },
  { encoding: "euc-jp", label: "EUC-JP", family: "dbcs", scripts: ["japanese"] },
  { encoding: "euc-kr", label: "EUC-KR", family: "dbcs", scripts: ["korean"] },

  { encoding: "windows-1252", label: "Windows-1252", family: "sbcs", scripts: ["latin"] },
  { encoding: "iso-8859-1", label: "ISO-8859-1", family: "sbcs", scripts: ["latin"] },
  { encoding: "iso-8859-2", label: "ISO-8859-2", family: "sbcs", scripts: ["latin"] },
  { encoding: "windows-1250", label: "Windows-1250", family: "sbcs", scripts: ["latin"] },
  { encoding: "windows-1251", label: "Windows-1251", family: "sbcs", scripts: ["cyrillic"] },
  { encoding: "koi8-r", label: "KOI8-R", family: "sbcs", scripts: ["cyrillic"] },
  { encoding: "iso-8859-5", label: "ISO-8859-5", family: "sbcs", scripts: ["cyrillic"] },
  { encoding: "windows-1253", label: "Windows-1253", family: "sbcs", scripts: ["greek"] },
  { encoding: "iso-8859-7", label: "ISO-8859-7", family: "sbcs", scripts: ["greek"] },
  { encoding: "windows-1256", label: "Windows-1256", family: "sbcs", scripts: ["arabic"] },
  { encoding: "windows-1255", label: "Windows-1255", family: "sbcs", scripts: ["hebrew"] },
  { encoding: "windows-1254", label: "Windows-1254", family: "sbcs", scripts: ["latin"] },
  { encoding: "iso-8859-9", label: "ISO-8859-9", family: "sbcs", scripts: ["latin"] },
  { encoding: "windows-1257", label: "Windows-1257", family: "sbcs", scripts: ["latin"] },
  { encoding: "windows-874", label: "Windows-874", family: "sbcs", scripts: ["thai"] }
]

const cache = new Map()
export function canEncode (encoding) {
  let v = cache.get(encoding)
  if (v === undefined) {
    v = iconv.encodingExists(encoding)
    cache.set(encoding, v)
  }
  return v
}

// Decode and report whether the same bytes come back.
// Returns { text, lossless, byteLength } — `text` is always usable for previews.
export function roundTrip (buf, encoding) {
  if (!canEncode(encoding)) return null
  let text
  try {
    text = iconv.decode(buf, encoding)
  } catch (e) {
    return { text: "", lossless: false, byteLength: 0, error: e.message }
  }
  let back
  try {
    back = iconv.encode(text, encoding)
  } catch (e) {
    return { text: text, lossless: false, byteLength: 0, error: e.message }
  }
  const lossless = back.length === buf.length && Buffer.from(back).equals(Buffer.from(buf))
  return { text: text, lossless: lossless, byteLength: back.length }
}

// Narrow down the first byte offset where a round trip stops being lossless,
// by bisecting the buffer. O(log n) decodes instead of O(n).
export function firstLossyOffset (buf, encoding, budget) {
  const limit = budget || 24
  let calls = 0
  function lossless (slice) {
    calls++
    const r = roundTrip(slice, encoding)
    return r !== null && r.lossless
  }
  if (lossless(buf)) return { at: -1, calls: calls }
  let lo = 0
  let hi = buf.length
  // Find the smallest prefix that is already lossy.
  while (lo < hi && calls < limit) {
    const mid = (lo + hi) >> 1
    if (lossless(buf.subarray(0, mid))) lo = mid + 1
    else hi = mid
  }
  // Walk back a little: multi-byte sequences make the exact byte ambiguous.
  let at = Math.max(0, lo - 1)
  for (let k = at; k <= Math.min(buf.length - 1, at + 8); k++) {
    if (!lossless(buf.subarray(0, k + 1))) { at = k; break }
  }
  return { at: at, calls: calls }
}
