// repair(): undo a wrong decode.
//
// The situation this addresses: nobody hands you a byte stream with an unknown
// encoding very often. What actually happens is that a file was decoded with the
// wrong code page somewhere upstream and you are looking at the wreckage —
// "æ´å¤æä½œ" or "鏇村鎿嶄綔" or a string full of U+FFFD.
//
// Recovery is deterministic when the wrong decoding was lossless: re-encode with
// the wrong codec, decode with the right one, and the original bytes come back.
// When the wrong decoding already destroyed bytes (U+FFFD appeared), we say so
// and point at the damage instead of pretending.

import iconv from "../index-node.js"
import { naturalness } from "./blocks.js"
import { textQuality } from "./commonness.js"
import { canEncode } from "./charset.js"
import { analyze } from "./detect.js"

// Encodings that are commonly the *wrong* one in a mojibake chain.
// Order matters only for reporting when several chains score identically.
const WRONG_GUESSES = [
  "windows-1252",
  "iso-8859-1",
  "gb18030",
  "big5",
  "shiftjis",
  "euc-kr",
  "windows-1251",
  "windows-1253",
  "windows-1254",
  "windows-1256",
  "windows-1257",
  "iso-8859-2",
  "windows-1250",
  "iso-8859-5",
  "koi8-r",
  "windows-874"
]

// The original bytes of a mojibake string are almost always UTF-8. UTF-16 is
// deliberately excluded: any even-length buffer decodes to *something* under
// UTF-16, which turns the search into a false-positive generator.
const RIGHT_GUESSES = ["utf-8"]

const REPLACEMENT = "\ufffd"

// Re-encode with the presumed-wrong codec.
//
// A strict round trip is the ideal check, but East Asian code pages are not
// injective: GBK decodes both 0x80 and 0xA2E3 to U+20AC, so encoding U+20AC
// back can pick the other byte and break equality even though nothing is lost.
// We therefore accept a high-fidelity round trip (>= 90% of characters survive
// unchanged) and report the fidelity, instead of throwing away good repairs.
const MIN_FIDELITY = 0.9

function writeBytes (text, encoding) {
  let bytes
  try {
    bytes = iconv.encode(text, encoding)
  } catch (e) {
    return null
  }
  let back
  try {
    back = iconv.decode(bytes, encoding)
  } catch (e) {
    return null
  }
  if (back === text) return { bytes: Buffer.from(bytes), fidelity: 1, mismatches: 0 }
  if (back.length !== text.length) return null
  let same = 0
  let firstMismatch = -1
  for (let i = 0; i < text.length; i++) {
    if (back[i] === text[i]) same++
    else if (firstMismatch === -1) firstMismatch = i
  }
  const fidelity = same / text.length
  if (fidelity < MIN_FIDELITY) return null
  return { bytes: Buffer.from(bytes), fidelity: fidelity, mismatches: text.length - same, firstMismatch: firstMismatch }
}

function readStrict (bytes, encoding) {
  if (!canEncode(encoding)) return null
  let text
  try {
    text = iconv.decode(bytes, encoding)
  } catch (e) {
    return null
  }
  if (encoding === "utf-8") {
    // iconv-lite substitutes on invalid input; a replacement char means the
    // hypothesis is wrong, not that the text is fine.
    if (text.indexOf(REPLACEMENT) !== -1) return null
  }
  return text
}

function countReplacement (text) {
  let n = 0
  for (let i = 0; i < text.length; i++) if (text[i] === REPLACEMENT) n++
  return n
}

function positionsOf (text, ch, limit) {
  const out = []
  let idx = text.indexOf(ch)
  while (idx !== -1 && out.length < (limit || 8)) {
    out.push(idx)
    idx = text.indexOf(ch, idx + 1)
  }
  return out
}

// One pass: try every (wrong, right) pair and keep the ones that both re-encode
// losslessly and produce text that is measurably more "written" than the input.
function onePass (text, depth) {
  const before = textQuality(text)
  const attempts = []
  for (const wrong of WRONG_GUESSES) {
    if (!canEncode(wrong)) continue
    const enc = writeBytes(text, wrong)
    if (!enc) continue
    for (const right of RIGHT_GUESSES) {
      const fixed = readStrict(enc.bytes, right)
      if (fixed === null || fixed === text) continue
      const after = textQuality(fixed)
      attempts.push({
        chain: ["as " + wrong, "as " + right],
        wrong: wrong,
        right: right,
        fidelity: enc.fidelity,
        text: fixed,
        bytes: enc.bytes,
        beforeScore: before.score,
        afterScore: after.score,
        gain: after.score - before.score,
        depth: depth
      })
    }
  }
  attempts.sort(function (a, b) {
    if (b.gain !== a.gain) return b.gain - a.gain
    // Prefer the chain that changes more characters when the gain ties.
    return Math.abs(b.text.length - text.length) - Math.abs(a.text.length - a.text.length)
  })
  return { attempts: attempts, before: before }
}

// A repair is only accepted when it makes the text clearly more like writing.
// 0.15 is deliberately conservative: a genuine mojibake fix usually moves the
// score by 0.3 or more, while unrelated re-interpretations move it by ~0.01.
const MIN_GAIN = 0.15

export function repair (input, options) {
  const opts = options || {}
  const maxDepth = opts.maxDepth === undefined ? 2 : opts.maxDepth
  const result = {
    changed: false,
    text: null,
    input: null,
    reversible: true,
    damage: [],
    chain: [],
    attempts: [],
    why: []
  }

  let text
  if (typeof input === "string") {
    text = input
    result.input = "text"
  } else {
    const buf = Buffer.from(input)
    result.input = "bytes"
    const report = analyze(buf, { maxCandidates: 8 })
    if (report.verdict === "certain" || report.verdict === "probable" || report.verdict === "ascii") {
      const enc = report.encoding === "ascii" ? "utf-8" : report.encoding
      // The bytes decode cleanly, but the *text* they decode to may itself be
      // mojibake — that is what a file looks like after someone saved a string
      // that had already been decoded with the wrong code page. So keep going
      // and run the textual pass; if nothing is wrong it changes nothing.
      text = iconv.decode(buf, enc)
      result.encoding = report.encoding
      result.report = report
      result.why.push("input bytes are valid " + (report.encodingLabel || report.encoding) + "; checked the decoded text for mojibake")
    } else if (report.verdict === "ambiguous") {
      // Several code pages explain these bytes equally well. Picking one here
      // would be a guess dressed up as a repair, so we refuse and hand back the
      // analysis instead.
      result.text = report.preview || iconv.decode(buf, "utf-8")
      result.changed = false
      result.needsEncoding = true
      result.report = report
      result.why.push("the bytes can be explained by " + report.candidates.length + " encodings with no byte-level evidence to choose between them")
      result.why.push("refusing to guess an encoding; re-run with a known encoding, or pass the already-decoded text to repair()")
      result.why.push("candidates: " + report.candidates.slice(0, 6).map(function (c) { return c.label }).join(", "))
      return result
    } else {
      // Binary / unknown: treat the raw bytes as a mojibake carrier. Windows-1252
      // is used because it is the code page browsers fall back to, so it is the
      // most common way a UTF-8 file turns into a string of odd Latin characters.
      text = iconv.decode(buf, "windows-1252")
      result.why.push("input bytes had no clean reading (" + report.verdict + "); treated as a mojibake carrier via Windows-1252")
      result.report = report
    }
  }

  const damageIn = countReplacement(text)
  if (damageIn > 0) {
    // Refuse to guess. Once a byte was replaced by U+FFFD the original value is
    // gone; any "recovery" from here would be invention, not recovery.
    result.reversible = false
    result.text = text
    result.damage = positionsOf(text, REPLACEMENT).map(function (p) {
      return { at: p, kind: "replacement-character", detail: "a byte here was already lost before repair ran" }
    })
    result.why.push(damageIn + " replacement characters (U+FFFD) are present: the wrong decode already dropped bytes")
    result.why.push("no automatic repair is attempted, because the missing byte values cannot be inferred; recover the original byte stream instead")
    if (result.input === "bytes") {
      result.why.push("the input was decoded with a code page that could not represent every byte; try analyze() on the raw bytes")
    }
    return result
  }

  let current = text
  let depth = 0
  while (depth < maxDepth) {
    const pass = onePass(current, depth)
    result.attempts = result.attempts.concat(pass.attempts.slice(0, 5))
    if (!pass.attempts.length) break
    const best = pass.attempts[0]
    if (best.gain < MIN_GAIN) break
    current = best.text
    result.chain.push({
      as: best.wrong,
      then: best.right,
      gain: Number(best.gain.toFixed(3)),
      fidelity: best.fidelity === undefined ? 1 : Number(best.fidelity.toFixed(3))
    })
    result.changed = true
    depth++
    // A second pass is only worth it if the first left obvious mojibake behind.
    if (depth < maxDepth && !looksLikeMojibake(current)) break
  }

  if (result.changed) {
    result.text = current
    const beforeQ = textQuality(text)
    const afterQ = textQuality(current)
    result.why.push("re-encoding as " + result.chain.map(function (c) { return c.as }).join(" then ") +
      " and decoding as " + result.chain[result.chain.length - 1].then + " restored valid text")
    result.why.push("quality " + beforeQ.score.toFixed(3) + " -> " + afterQ.score.toFixed(3) +
      " (naturalness " + beforeQ.naturalness.toFixed(3) + " -> " + afterQ.naturalness.toFixed(3) +
      (afterQ.commonness === null ? "" : ", common-character rate " + afterQ.commonness.toFixed(3) + " under " + afterQ.commonnessEncoding) + ")")
    result.quality = { before: Number(beforeQ.score.toFixed(3)), after: Number(afterQ.score.toFixed(3)) }
    const damageOut = countReplacement(current)
    if (damageOut > 0) {
      result.reversible = false
      result.damage = positionsOf(current, REPLACEMENT).map(function (p) {
        return { at: p, kind: "replacement-character", detail: "irrecoverable: the original byte was dropped upstream" }
      })
    }
  } else if (!result.why.length) {
    result.why.push("no lossless re-decode produced more natural text; leaving the input unchanged")
    if (damageIn > 0) {
      result.why.push(damageIn + " replacement characters are present: information was lost before this call and cannot be recovered by re-decoding")
      result.why.push("if the original byte stream is still available, call analyze()/repair() on the bytes instead of the string")
    }
  }

  if (result.text === null) result.text = text
  return result
}

// Cheap heuristic used only to decide whether a second repair pass is worth
// attempting. Never used to decide the verdict.
export function looksLikeMojibake (text) {
  if (!text) return false
  const nat = naturalness(text)
  if (nat.debris > 0) return true
  // C1 controls and the classic UTF-8-as-Latin-1 pairs.
  if (/[\u0080-\u009f]/.test(text)) return true
  if (/[\u00c2\u00c3\u00c5\u00e2][\u0080-\u00bf]/.test(text)) return true
  if (text.indexOf("\u00ef\u00bb\u00bf") !== -1) return true
  return nat.score < 0.75
}
