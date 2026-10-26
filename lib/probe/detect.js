// analyze(): the main entry point.
//
// Design rule: never return a single guessed encoding with a made-up confidence.
// Every verdict carries the evidence that produced it, and when the evidence
// cannot separate the candidates the verdict is "ambiguous" — which is a result,
// not a failure. See README "What this does not do".

import iconv from "../index-node.js"
import { validateUtf8, analyzeUtf16, analyzeUtf32, codePointLength } from "./unicode-validate.js"
import { naturalness, classify } from "./blocks.js"
import { CANDIDATES, roundTrip, canEncode } from "./charset.js"

const BOMS = [
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: "utf-32le", label: "UTF-32LE" },
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: "utf-32be", label: "UTF-32BE" },
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8", label: "UTF-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le", label: "UTF-16LE" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be", label: "UTF-16BE" }
]

// A UTF-16/32 guess is only allowed to become a verdict above this many code
// units. Below it the byte pattern is genuinely ambiguous: 8 characters of
// Chinese and 8 characters of GBK have the same length and both parse.
const MIN_UNITS_FOR_UNICODE_VERDICT = 8

export function detectBom (buf) {
  for (const b of BOMS) {
    if (buf.length < b.bytes.length) continue
    let match = true
    for (let i = 0; i < b.bytes.length; i++) {
      if (buf[i] !== b.bytes[i]) { match = false; break }
    }
    if (match) return { encoding: b.encoding, label: b.label, length: b.bytes.length, bytes: b.bytes.slice() }
  }
  return null
}

function asBuffer (input) {
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (typeof input === "string") return null
  throw new TypeError("analyze() accepts a Buffer, a Uint8Array, or a string")
}

function asciiRatio (buf) {
  let printable = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) printable++
  }
  return printable / (buf.length || 1)
}

function controlCount (buf) {
  let n = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 12 && b !== 13) n++
  }
  return n
}

function previewOf (text) {
  if (!text) return null
  const cut = text.slice(0, 120)
  // Control characters are escaped so a preview can never corrupt a terminal.
  /* eslint-disable no-control-regex */
  return cut.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, function (c) {
    return "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")
  })
  /* eslint-enable no-control-regex */
}

// Decode with the BOM removed so the preview does not start with U+FEFF.
function decodeAfterBom (buf, bom) {
  const body = buf.subarray(bom.length)
  try {
    return iconv.decode(body, bom.encoding)
  } catch (e) {
    return null
  }
}

export function analyze (input, options) {
  const opts = options || {}
  const maxCandidates = opts.maxCandidates || 6
  const report = {
    kind: "bytes",
    bytes: 0,
    verdict: "unknown",
    encoding: null,
    confidence: 0,
    bom: null,
    why: [],
    candidates: [],
    unicode: null,
    preview: null,
    naturalness: null,
    notes: []
  }

  if (typeof input === "string") {
    // A string has already been decoded by someone else; only textual analysis applies.
    const nat = naturalness(input)
    report.kind = "text"
    report.bytes = Buffer.byteLength(input, "utf8")
    report.naturalness = nat
    report.preview = previewOf(input)
    report.verdict = "text-only"
    report.why.push("input is already a string, so byte-level encoding cannot be determined here")
    report.why.push("naturalness " + nat.score.toFixed(3) + " over " + nat.total + " code points; use repair() to test for mojibake")
    if (nat.debris > 0) {
      report.notes.push(nat.debris + " code points are control/private-use/replacement characters")
    }
    return report
  }

  const buf = asBuffer(input)
  report.bytes = buf.length

  if (buf.length === 0) {
    report.verdict = "empty"
    report.why.push("zero bytes")
    return report
  }

  // 1. BOM is authoritative.
  const bom = detectBom(buf)
  report.bom = bom
  if (bom) {
    report.verdict = "certain"
    report.encoding = bom.encoding
    report.confidence = 1
    report.why.push("input starts with " + bom.bytes.map(function (b) { return b.toString(16).padStart(2, "0") }).join(" ") + " (" + bom.label + " BOM)")
    const text = decodeAfterBom(buf, bom)
    if (text !== null) {
      report.preview = previewOf(text)
      report.naturalness = naturalness(text)
    }
    return report
  }

  // 2. Pure ASCII is unambiguous.
  const aRatio = asciiRatio(buf)
  if (aRatio === 1) {
    report.verdict = "certain"
    report.encoding = "ascii"
    report.confidence = 1
    report.encodingLabel = "ASCII"
    report.why.push("every byte is in the printable-ASCII range or a text whitespace")
    report.preview = previewOf(buf.toString("latin1"))
    report.naturalness = naturalness(buf.toString("latin1"))
    return report
  }

  // 3. Structural Unicode validation.
  const utf8 = validateUtf8(buf)
  const u16le = analyzeUtf16(buf, true)
  const u16be = analyzeUtf16(buf, false)
  const u32le = analyzeUtf32(buf, true)
  const u32be = analyzeUtf32(buf, false)
  report.unicode = { utf8: utf8, utf16le: u16le, utf16be: u16be, utf32le: u32le, utf32be: u32be }

  if (utf8.ok && utf8.multiByte > 0) {
    const text = iconv.decode(buf, "utf-8")
    const nat = naturalness(text)
    report.encoding = "utf-8"
    report.encodingLabel = "UTF-8"
    report.preview = previewOf(text)
    report.naturalness = nat
    report.why.push("all " + utf8.sequences + " UTF-8 sequences are well-formed (" + utf8.multiByte + " multi-byte)")
    if (nat.score >= 0.9) {
      report.confidence = 0.99
      report.verdict = "certain"
      report.why.push("decoded text naturalness " + nat.score.toFixed(3))
    } else {
      // The bytes are structurally perfect UTF-8, so that is what they are. But
      // the resulting text is mostly non-writing characters, which means someone
      // already decoded these bytes with the wrong code page before saving them.
      // We state the encoding and point at repair() instead of pretending the
      // text is fine.
      report.confidence = 0.85
      report.verdict = "probable"
      report.why.push("the bytes are valid UTF-8, but naturalness is only " + nat.score.toFixed(3) +
        ": the text itself looks like it was already mis-decoded upstream")
      report.notes.push("this is a candidate for repair(); the byte-level encoding is not in question")
    }
    return report
  }

  // 4. BOM-less UTF-16 / UTF-32.
  const unicodeGuess = pickBomlessUnicode(buf, report, u16le, u16be, u32le, u32be)
  if (unicodeGuess && report.verdict === "unknown") {
    const text = iconv.decode(buf, unicodeGuess.encoding)
    const nat = naturalness(text)
    if (nat.score >= 0.9) {
      report.encoding = unicodeGuess.encoding
      report.encodingLabel = unicodeGuess.label
      report.confidence = unicodeGuess.confidence
      report.verdict = "probable"
      report.preview = previewOf(text)
      report.naturalness = nat
      report.why.push("no BOM, but read as " + unicodeGuess.label + ": " + unicodeGuess.units + " code units, " +
        (unicodeGuess.plausibleRate * 100).toFixed(1) + "% land in writing-system blocks")
      report.why.push("NUL bytes appear in the high position of " + (unicodeGuess.highZeroRatio * 100).toFixed(1) +
        "% of units — no single- or double-byte code page produces this in real text")
      report.why.push("surrogate errors " + unicodeGuess.surrogateErrors + "; the other endianness scores " +
        (unicodeGuess.otherRate * 100).toFixed(1) + "%")
      report.notes.push("a BOM-less UTF-16/32 verdict rests on the NUL pattern; if the file is known to be text without ASCII, verify before trusting it")
      return report
    }
  }

  // 5. Legacy single/double-byte candidates, by lossless round trip.
  // A single-byte codec can always reproduce its own bytes, so "lossless" alone
  // is not enough for it: the decoded text must also look like one script.
  const survivors = []
  for (const c of CANDIDATES) {
    if (c.family === "unicode") continue
    if (!canEncode(c.encoding)) continue
    const rt = roundTrip(buf, c.encoding)
    if (!rt || !rt.lossless) continue
    const nat = naturalness(rt.text)
    if (c.family === "sbcs" && (nat.score < 0.9 || nat.dominance < 0.7)) continue
    survivors.push({
      encoding: c.encoding,
      label: c.label,
      family: c.family,
      naturalness: nat.score,
      dominance: nat.dominance,
      dominant: nat.dominant,
      text: rt.text,
      kinds: nat.kinds
    })
  }
  survivors.sort(function (a, b) {
    if (b.naturalness !== a.naturalness) return b.naturalness - a.naturalness
    return b.dominance - a.dominance
  })
  report.candidates = survivors.slice(0, maxCandidates).map(function (s) {
    return {
      encoding: s.encoding,
      label: s.label,
      family: s.family,
      naturalness: Number(s.naturalness.toFixed(3)),
      dominance: Number(s.dominance.toFixed(3)),
      dominant: s.dominant,
      losslessRoundTrip: true
    }
  })

  // Binary check: high control-byte density that no survivor explains.
  const ctrl = controlCount(buf)
  if (!survivors.length && (ctrl / buf.length > 0.05 || aRatio < 0.85)) {
    report.verdict = "binary"
    report.why.push("no candidate encoding can reproduce these bytes")
    report.why.push((ctrl / buf.length * 100).toFixed(1) + "% of bytes are non-text control bytes; printable-ASCII share is " + (aRatio * 100).toFixed(1) + "%")
    return report
  }

  if (survivors.length === 1) {
    const only = survivors[0]
    report.encoding = only.encoding
    report.encodingLabel = only.label
    report.confidence = 0.85
    report.verdict = "probable"
    report.preview = previewOf(only.text)
    report.naturalness = { score: only.naturalness, kinds: only.kinds }
    report.why.push("exactly one candidate encoding reproduces the input byte-for-byte: " + only.label)
    report.why.push("decoded text naturalness " + only.naturalness.toFixed(3))
    return report
  }

  if (survivors.length > 1) {
    report.verdict = "ambiguous"
    report.why.push("no BOM, and the bytes are not valid multi-byte UTF-8")
    report.why.push(survivors.length + " legacy encodings each reproduce the input byte-for-byte: " +
      survivors.slice(0, 5).map(function (s) { return s.label }).join(", "))
    report.why.push("byte-level evidence cannot separate them — the same bytes decode to different but equally well-formed text; a statistical language model would be required")
    // Keep the best-scoring one as a hint, clearly labelled as a hint.
    const hint = survivors[0]
    report.hint = { encoding: hint.encoding, label: hint.label, naturalness: hint.naturalness }
    report.preview = previewOf(hint.text)
    report.notes.push("`hint` is the highest naturalness candidate among equals; it is not a determination")
    return report
  }

  // Nothing survived the round trip.
  report.verdict = "unknown"
  report.why.push("no candidate encoding reproduces the input byte-for-byte")
  if (utf8.errorCount) {
    const e = utf8.errors[0]
    report.why.push("first UTF-8 structural error at byte " + e.at + ": " + e.kind + " (" + e.detail + ")")
  }
  report.verdict = "binary"
  return report
}

// BOM-less Unicode is only accepted when the NUL-byte pattern proves it.
//
// Measured fact: every single- and double-byte code page produces a high-byte
// NUL ratio of exactly 0.0% on real text, because no real text contains U+0000.
// UTF-16 of text that contains any ASCII puts 0x00 in every other position and
// lands between 30% and 71%. Nothing in between was observed.
//
// The consequence is deliberate: BOM-less UTF-16 holding *pure* CJK has a NUL
// ratio of 0%, is byte-for-byte indistinguishable from a legacy encoding, and is
// therefore NOT guessed. We say so in `notes` instead.
const MIN_ZERO_RATIO_UTF16 = 0.15
const MIN_ZERO_RATIO_UTF32 = 0.5

function pickBomlessUnicode (buf, report, u16le, u16be, u32le, u32be) {
  if (buf.length % 2 !== 0) {
    report.notes.push("odd byte length rules out UTF-16 and UTF-32")
    return null
  }
  const options = [
    { encoding: "utf-32le", label: "UTF-32LE", s: u32le, other: u32be, stride: 4, minZero: MIN_ZERO_RATIO_UTF32 },
    { encoding: "utf-32be", label: "UTF-32BE", s: u32be, other: u32le, stride: 4, minZero: MIN_ZERO_RATIO_UTF32 },
    { encoding: "utf-16le", label: "UTF-16LE", s: u16le, other: u16be, stride: 2, minZero: MIN_ZERO_RATIO_UTF16 },
    { encoding: "utf-16be", label: "UTF-16BE", s: u16be, other: u16le, stride: 2, minZero: MIN_ZERO_RATIO_UTF16 }
  ]

  const viable = options.filter(function (o) {
    if (o.stride === 4 && buf.length % 4 !== 0) return false
    return o.s.aligned &&
      o.s.units >= MIN_UNITS_FOR_UNICODE_VERDICT &&
      o.s.highZeroRatio >= o.minZero &&
      o.s.plausibleRate >= 0.98 &&
      o.s.surrogateErrors === 0 &&
      o.s.controlRate <= 0.02
  })

  if (!viable.length) {
    // Distinguish "no evidence of Unicode" from "evidence we cannot act on".
    const clean = options.filter(function (o) {
      return o.s.units >= MIN_UNITS_FOR_UNICODE_VERDICT && o.s.plausibleRate >= 0.98 &&
        o.s.surrogateErrors === 0 && o.s.controlRate <= 0.02
    })
    if (clean.length) {
      report.notes.push("this could also be BOM-less UTF-16/32 of text with no ASCII characters; " +
        "such input is byte-for-byte indistinguishable from a legacy encoding, so no Unicode verdict is given")
    } else {
      const best = options.slice().sort(function (a, b) { return b.s.plausibleRate - a.s.plausibleRate })[0]
      if (best && best.s.units > 0 && best.s.units < MIN_UNITS_FOR_UNICODE_VERDICT && best.s.plausibleRate >= 0.98) {
        report.notes.push("only " + best.s.units + " code units (" + best.label + "); below the " +
          MIN_UNITS_FOR_UNICODE_VERDICT + "-unit threshold for a Unicode verdict, so no answer is given")
      }
    }
    return null
  }

  // Prefer the narrowest stride, then the stronger NUL pattern.
  viable.sort(function (a, b) {
    if (a.stride !== b.stride) return a.stride - b.stride
    return b.s.highZeroRatio - a.s.highZeroRatio
  })
  const pick = viable[0]
  if (pick.stride === 4) {
    const u16 = pick.encoding === "utf-32le" ? u16le : u16be
    if (u16.plausibleRate >= 0.98 && u16.highZeroRatio >= MIN_ZERO_RATIO_UTF16 && u16.surrogateErrors === 0) {
      report.notes.push("both UTF-32 and UTF-16 readings are plausible; not choosing between them")
      return null
    }
  }
  return {
    encoding: pick.encoding,
    label: pick.label,
    units: pick.s.units,
    plausibleRate: pick.s.plausibleRate,
    surrogateErrors: pick.s.surrogateErrors,
    highZeroRatio: pick.s.highZeroRatio,
    otherRate: pick.other.plausibleRate,
    confidence: 0.85
  }
}

export { codePointLength, classify }
