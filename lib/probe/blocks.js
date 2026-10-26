// Coarse Unicode block classification, used to score how much a decoded string
// resembles natural text.
//
// The table is deliberately coarse. Fine-grained script detection would need
// megabytes of tables and would not change any decision this library makes:
// the only question asked here is "does this string look like writing, or like
// the debris of a wrong decoding".

const RANGES = [
  [0x0000, 0x0008, "control"],
  [0x0009, 0x000a, "ascii"],
  [0x000b, 0x000c, "control"],
  [0x000d, 0x000d, "ascii"],
  [0x000e, 0x001f, "control"],
  [0x0020, 0x007e, "ascii"],
  [0x007f, 0x009f, "control"], // DEL + C1 controls: the signature of a latin1 misread
  // U+00A0-U+00BF are Latin-1 *symbols* (¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿), not letters.
  // Counting them as writing would let a Windows-1252 misread of GBK bytes score 1.0.
  [0x00a0, 0x00bf, "symbol"],
  [0x00c0, 0x00d6, "latin"],
  [0x00d7, 0x00d7, "symbol"],
  [0x00d8, 0x00f6, "latin"],
  [0x00f7, 0x00f7, "symbol"],
  [0x00f8, 0x024f, "latin"],
  [0x0250, 0x02ff, "latin"],
  [0x0300, 0x036f, "symbol"], // combining marks, only meaningful on a base char
  [0x0370, 0x03ff, "greek"],
  [0x0400, 0x052f, "cyrillic"],
  [0x0530, 0x058f, "armenian"],
  [0x0590, 0x05ff, "hebrew"],
  [0x0600, 0x06ff, "arabic"],
  [0x0700, 0x074f, "syriac"],
  [0x0750, 0x077f, "arabic"],
  [0x0780, 0x07bf, "thaana"],
  [0x0900, 0x097f, "devanagari"],
  [0x0980, 0x09ff, "bengali"],
  [0x0a00, 0x0a7f, "gurmukhi"],
  [0x0a80, 0x0aff, "gujarati"],
  [0x0b00, 0x0b7f, "oriya"],
  [0x0b80, 0x0bff, "tamil"],
  [0x0c00, 0x0c7f, "telugu"],
  [0x0c80, 0x0cff, "kannada"],
  [0x0d00, 0x0d7f, "malayalam"],
  [0x0d80, 0x0dff, "sinhala"],
  [0x0e00, 0x0e7f, "thai"],
  [0x0e80, 0x0eff, "lao"],
  [0x0f00, 0x0fff, "tibetan"],
  [0x1000, 0x109f, "myanmar"],
  [0x10a0, 0x10ff, "georgian"],
  [0x1100, 0x11ff, "hangul"],
  [0x1200, 0x137f, "ethiopic"],
  [0x1380, 0x139f, "ethiopic"],
  [0x13a0, 0x13ff, "cherokee"],
  [0x1400, 0x167f, "canadian"],
  [0x1680, 0x169f, "ogham"],
  [0x16a0, 0x16ff, "runic"],
  [0x1780, 0x17ff, "khmer"],
  [0x1800, 0x18af, "mongolian"],
  [0x1e00, 0x1eff, "latin"],
  [0x1f00, 0x1fff, "greek"],
  [0x2000, 0x206f, "punct"],
  [0x2070, 0x209f, "symbol"],
  [0x20a0, 0x20cf, "symbol"],
  [0x20d0, 0x20ff, "symbol"],
  [0x2100, 0x214f, "symbol"],
  [0x2150, 0x218f, "symbol"],
  [0x2190, 0x21ff, "symbol"],
  [0x2200, 0x22ff, "symbol"],
  [0x2300, 0x23ff, "symbol"],
  [0x2400, 0x243f, "symbol"],
  [0x2440, 0x245f, "symbol"],
  [0x2460, 0x24ff, "symbol"],
  [0x2500, 0x257f, "symbol"],
  [0x2580, 0x259f, "symbol"],
  [0x25a0, 0x25ff, "symbol"],
  [0x2600, 0x26ff, "symbol"],
  [0x2700, 0x27bf, "symbol"],
  [0x27c0, 0x27ef, "symbol"],
  [0x27f0, 0x27ff, "symbol"],
  [0x2800, 0x28ff, "symbol"],
  [0x2900, 0x297f, "symbol"],
  [0x2980, 0x29ff, "symbol"],
  [0x2a00, 0x2aff, "symbol"],
  [0x2b00, 0x2bff, "symbol"],
  [0x2c60, 0x2c7f, "latin"],
  [0x2c80, 0x2cff, "coptic"],
  [0x2d00, 0x2d2f, "georgian"],
  [0x2d30, 0x2d7f, "tifinagh"],
  [0x2e80, 0x2eff, "cjk-radical"],
  [0x2f00, 0x2fdf, "cjk-radical"],
  [0x2ff0, 0x2fff, "cjk-radical"],
  [0x3000, 0x303f, "cjk-punct"],
  [0x3040, 0x309f, "hiragana"],
  [0x30a0, 0x30ff, "katakana"],
  [0x3100, 0x312f, "bopomofo"],
  [0x3130, 0x318f, "hangul"],
  [0x3190, 0x319f, "katakana"],
  [0x31a0, 0x31bf, "bopomofo"],
  [0x31c0, 0x31ef, "cjk-radical"],
  [0x31f0, 0x31ff, "katakana"],
  [0x3200, 0x32ff, "symbol"],
  [0x3300, 0x33ff, "symbol"],
  [0x3400, 0x4dbf, "cjk-ext"],
  [0x4dc0, 0x4dff, "symbol"],
  [0x4e00, 0x9fff, "cjk"],
  [0xa000, 0xa48f, "yi"],
  [0xa490, 0xa4cf, "yi"],
  [0xa640, 0xa69f, "cyrillic"],
  [0xa720, 0xa7ff, "latin"],
  [0xa800, 0xa82f, "syloti"],
  [0xa840, 0xa87f, "phags-pa"],
  [0xac00, 0xd7af, "hangul"],
  [0xd7b0, 0xd7ff, "hangul"],
  [0xe000, 0xf8ff, "pua"],
  [0xf900, 0xfaff, "cjk-compat"],
  [0xfb00, 0xfb4f, "latin"],
  [0xfb50, 0xfdff, "arabic"],
  [0xfe00, 0xfe0f, "symbol"], // variation selectors
  [0xfe10, 0xfe1f, "cjk-punct"],
  [0xfe20, 0xfe2f, "symbol"],
  [0xfe30, 0xfe4f, "cjk-punct"],
  [0xfe50, 0xfe6f, "cjk-punct"],
  [0xfe70, 0xfeff, "arabic"],
  [0xff00, 0xffef, "fullwidth"],
  [0xfff0, 0xfff8, "control"],
  [0xfff9, 0xfffb, "symbol"],
  [0xfffc, 0xfffd, "replacement"],
  [0xfffe, 0xffff, "control"],
  [0xfdd0, 0xfdef, "control"],
  [0x10000, 0x1007f, "symbol"],
  [0x1d000, 0x1d24f, "symbol"],
  [0x1d400, 0x1d7ff, "symbol"],
  [0x1f000, 0x1f02f, "symbol"],
  [0x1f300, 0x1f5ff, "symbol"],
  [0x1f600, 0x1f64f, "symbol"],
  [0x1f900, 0x1f9ff, "symbol"],
  [0x20000, 0x2a6df, "cjk-ext"],
  [0x2f800, 0x2fa1f, "cjk-compat"]
]

// Sorted by start so we can binary search.
const SORTED = RANGES.slice().sort(function (a, b) { return a[0] - b[0] })

// kinds that count as "this is writing"
// CJK extension blocks (A/B and the compatibility ideographs) are deliberately
// excluded: they hold rare and historical characters, and a wrong decode of
// UTF-8 bytes lands in them constantly. Counting them as writing would let
// mojibake score as high as real text.
const WRITING = new Set([
  "ascii", "latin", "greek", "cyrillic", "armenian", "hebrew", "arabic", "syriac",
  "thaana", "devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil",
  "telugu", "kannada", "malayalam", "sinhala", "thai", "lao", "tibetan", "myanmar",
  "georgian", "hangul", "ethiopic", "cherokee", "canadian", "ogham", "runic",
  "khmer", "mongolian", "cjk", "cjk-punct", "hiragana",
  "katakana", "bopomofo", "yi", "coptic", "tifinagh", "syloti", "phags-pa",
  "cjk-radical", "fullwidth"
])

// kinds that indicate a decoding accident
const DEBRIS = new Set(["control", "pua", "replacement"])

// kinds that count as a *script* when deciding which writing system dominates.
// Punctuation, fullwidth forms and ASCII letters are excluded: they accompany
// any script and would flatten the measure.
const SCRIPT = new Set([
  "cjk", "hiragana", "katakana", "hangul", "latin",
  "greek", "cyrillic", "armenian", "hebrew", "arabic", "syriac", "thaana",
  "devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil", "telugu",
  "kannada", "malayalam", "sinhala", "thai", "lao", "tibetan", "myanmar",
  "georgian", "ethiopic", "cherokee", "canadian", "ogham", "runic", "khmer",
  "mongolian", "yi", "coptic", "tifinagh", "syloti", "phags-pa"
])

export function classify (codePoint) {
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return "surrogate"
  if (codePoint > 0x10ffff || codePoint < 0) return "invalid"
  let lo = 0
  let hi = SORTED.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = SORTED[mid]
    if (codePoint < r[0]) hi = mid - 1
    else if (codePoint > r[1]) lo = mid + 1
    else return r[2]
  }
  return "other"
}

export function isWriting (kind) {
  return WRITING.has(kind)
}

export function isDebris (kind) {
  return DEBRIS.has(kind)
}

// Score a string on [0, 1]: the share of characters that belong to writing systems.
// Debris (controls, private use, replacement chars) counts as zero.
//
// This is intentionally not a language model. It answers one question: after
// decoding, does the result look like writing at all? A wrong latin1 decode of
// UTF-8 Chinese produces C1 controls and stray Latin-1 symbols, so it scores low;
// the same bytes decoded as UTF-8 score 1.0.
export function naturalness (text) {
  const kinds = {}
  let total = 0
  let writing = 0
  let debris = 0
  let neutral = 0
  let dominant = null
  let dominantCount = 0
  let scriptTotal = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const kind = classify(cp)
    kinds[kind] = (kinds[kind] || 0) + 1
    total++
    if (isWriting(kind)) writing++
    else if (isDebris(kind)) debris++
    else neutral++
    if (SCRIPT.has(kind)) {
      scriptTotal++
      if (kinds[kind] > dominantCount) { dominant = kind; dominantCount = kinds[kind] }
    }
  }
  if (!total) {
    return { score: 0, total: 0, writing: 0, debris: 0, neutral: 0, kinds: {}, dominant: null, dominance: 0 }
  }
  return {
    score: writing / total,
    total: total,
    writing: writing,
    debris: debris,
    neutral: neutral,
    kinds: kinds,
    dominant: dominant,
    // Share of the dominant script among all script characters. A single-script
    // document scores ~1.0; a mixed one (Han + Kana from a wrong EUC-JP read)
    // scores lower. Used for ranking, never for a verdict.
    dominance: scriptTotal ? dominantCount / scriptTotal : 0
  }
}

export const KIND_TABLE = SORTED
