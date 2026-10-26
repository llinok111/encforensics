// How "commonly used" is this text, judged by the encoding standards themselves?
//
// Each East Asian double-byte standard splits its hanzi plane into a frequently
// used level and a rare level. GB2312 puts the 3755 common characters in
// 0xB0A1-0xD7F9 (sorted by pinyin) and the 3008 rare ones in 0xD8A1-0xF7FE.
// Big5 has a frequent block at 0xA440-0xC67E. JIS X 0208 level 1 sits at
// Shift_JIS 0x889F-0x9872, and KS X 1001 puts its common hangul at 0xB0A1-0xC8FE.
//
// That split *is* a frequency prior shipped with every code page, so we can use
// it without bundling a corpus: encode the character back into the standard and
// look at which block the bytes land in.
//
// Measured separation (vscode-loc zh-hans, 300 samples): real text scores 100%,
// the same text after a GBK misread scores 32.4%. This is the signal that
// separates two strings when both are "just hanzi", which block structure cannot.

import iconv from "../index-node.js"
import { naturalness } from "./blocks.js"

// First byte ranges of the most-used block in each standard.
const COMMON_BLOCKS = {
  gb18030: { lo: 0xb0, hi: 0xd7 }, // GB2312 level 1: 3755 common hanzi
  big5: { lo: 0xa4, hi: 0xc6 }, // Big5 frequent characters
  shiftjis: { lo: 0x88, hi: 0x98 }, // JIS X 0208 level 1
  "euc-kr": { lo: 0xb0, hi: 0xc8 } // KS X 1001 common hangul
}

function isHanziOrHangul (cp) {
  return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xac00 && cp <= 0xd7af)
}

// Sample large inputs instead of scanning all of them: the rate is stable long
// before the end of a document, and encoding is not free.
const MAX_SAMPLE = 4000

export function commonness (text, encoding) {
  const block = COMMON_BLOCKS[encoding]
  if (!block) return null
  const chars = []
  for (const ch of text) {
    if (!isHanziOrHangul(ch.codePointAt(0))) continue
    chars.push(ch)
    if (chars.length >= MAX_SAMPLE) break
  }
  if (!chars.length) return null

  let common = 0
  let encodable = 0
  for (const ch of chars) {
    let bytes
    try {
      bytes = iconv.encode(ch, encoding)
    } catch (e) {
      continue
    }
    if (bytes.length !== 2) continue // outside the double-byte plane
    encodable++
    if (bytes[0] >= block.lo && bytes[0] <= block.hi) common++
  }
  return {
    rate: encodable ? common / encodable : 0,
    considered: chars.length,
    encodable: encodable,
    common: common
  }
}

// Best commonness across the East Asian standards, or null when the text has no
// hanzi/hangul at all (Latin, Cyrillic, Arabic…). Null means "not applicable",
// never "bad".
export function bestCommonness (text) {
  let best = null
  let bestEncoding = null
  for (const enc of Object.keys(COMMON_BLOCKS)) {
    const r = commonness(text, enc)
    if (!r || !r.encodable) continue
    // A standard that can only represent 2 of 5 characters is not evidence of
    // anything; require it to cover most of the text before its rate counts.
    if (r.encodable < r.considered * 0.8) continue
    if (!best || r.rate > best.rate) { best = r; bestEncoding = enc }
  }
  if (!best) return null
  return { rate: best.rate, encoding: bestEncoding, considered: best.considered, encodable: best.encodable }
}

// A single comparable number on [0,1] combining "is this writing" with "is this
// the kind of writing people actually produce". Used to rank repair candidates
// and to decide whether a repair is an improvement. Never used alone to name an
// encoding.
export function textQuality (text) {
  const nat = naturalness(text)
  const c = bestCommonness(text)
  // With no hanzi/hangul present the commonness factor is neutral (1).
  const commonFactor = c === null ? 1 : 0.5 + 0.5 * c.rate
  // Script dominance is reported but deliberately NOT multiplied in: Japanese
  // prose legitimately mixes Han, hiragana and katakana, and penalising that
  // made the repair layer rewrite correct Japanese into mojibake.
  return {
    score: nat.score * commonFactor,
    naturalness: nat.score,
    commonness: c === null ? null : c.rate,
    commonnessEncoding: c === null ? null : c.encoding,
    dominance: nat.dominance
  }
}
