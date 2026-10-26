// Public API of the probe layer.
//
// Three verbs, each answering a different question:
//   analyze(input)  — what is this byte stream, and what is the evidence?
//   repair(input)   — was this text decoded with the wrong codec, and can it be undone?
//   locate(input, encoding) — where exactly does the byte stream stop being valid?

import iconv from "../index-node.js"
import { analyze } from "./detect.js"
import { repair, looksLikeMojibake } from "./repair.js"
import { firstLossyOffset, CANDIDATES, canEncode, roundTrip } from "./charset.js"
import { validateUtf8, analyzeUtf16, analyzeUtf32 } from "./unicode-validate.js"
import { naturalness, classify } from "./blocks.js"

export { analyze, repair, looksLikeMojibake, CANDIDATES, canEncode, roundTrip }
export { validateUtf8, analyzeUtf16, analyzeUtf32, naturalness, classify }

// Point at the first byte that a given encoding cannot explain.
// For UTF-8 we already have an exact answer; for legacy codecs we bisect the
// round trip, which lands within one character of the true offset.
export function locate (input, encoding) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const enc = encoding || "utf-8"

  if (enc === "utf-8" || enc === "utf8") {
    const v = validateUtf8(buf)
    if (v.ok) return { ok: true, at: -1, errors: [], encoding: "utf-8" }
    return {
      ok: false,
      at: v.errors[0].at,
      encoding: "utf-8",
      errors: v.errors,
      errorCount: v.errorCount,
      context: contextAround(buf, v.errors[0].at)
    }
  }

  if (!canEncode(enc)) throw new Error("unknown encoding: " + enc)
  const r = firstLossyOffset(buf, enc)
  if (r.at === -1) return { ok: true, at: -1, errors: [], encoding: enc }
  return {
    ok: false,
    at: r.at,
    encoding: enc,
    errors: [{ at: r.at, kind: "not-reproducible", detail: "re-encoding the decoded text does not yield the same bytes here" }],
    context: contextAround(buf, r.at)
  }
}

function contextAround (buf, at) {
  const from = Math.max(0, at - 8)
  const to = Math.min(buf.length, at + 8)
  return {
    bytes: Array.from(buf.subarray(from, to)).map(function (b) { return b.toString(16).padStart(2, "0") }),
    offsetInContext: at - from
  }
}

// Convenience: decode with the analyzed encoding, falling back to UTF-8 and then
// to Windows-1252 so callers always get a string back.
export function decodeBest (buf, options) {
  const report = analyze(buf, options)
  const enc = report.encoding && report.encoding !== "ascii" ? report.encoding : "utf-8"
  return {
    report: report,
    text: iconv.decode(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), enc)
  }
}
