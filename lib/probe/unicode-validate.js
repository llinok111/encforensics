// Structural validation of Unicode byte sequences.
//
// Everything here is deterministic: no statistics, no thresholds. Either a byte
// sequence is well-formed per the Unicode standard or it is not, and if it is
// not we can say exactly which byte broke it and why. That exactness is what
// makes damage reports trustworthy.

import { classify, isWriting } from "./blocks.js"

// Unicode Standard 15.x, Table 3-7 (well-formed UTF-8 byte sequences).
// Returns per-byte diagnostics rather than a single boolean.
export function validateUtf8 (buf) {
  const errors = []
  let multiByte = 0
  let ascii = 0
  let i = 0
  while (i < buf.length) {
    const b = buf[i]
    if (b < 0x80) { ascii++; i++; continue }

    let need
    let low = 0x80
    let high = 0xbf
    if (b >= 0xc2 && b <= 0xdf) { need = 1 } else if (b === 0xe0) { need = 2; low = 0xa0 } else if (b >= 0xe1 && b <= 0xec) { need = 2 } else if (b === 0xed) { need = 2; high = 0x9f } else if (b >= 0xee && b <= 0xef) { need = 2 } else if (b === 0xf0) { need = 3; low = 0x90 } else if (b >= 0xf1 && b <= 0xf3) { need = 3 } else if (b === 0xf4) { need = 3; high = 0x8f } else if (b >= 0xc0 && b <= 0xc1) {
      errors.push({ at: i, sequenceStart: i, kind: "overlong-lead", detail: "0x" + b.toString(16) + " can only start an overlong form" })
      i++
      continue
    } else if (b >= 0x80 && b <= 0xbf) {
      errors.push({ at: i, sequenceStart: i, kind: "stray-continuation", detail: "0x" + b.toString(16) })
      i++
      continue
    } else {
      errors.push({ at: i, sequenceStart: i, kind: "invalid-lead", detail: "0x" + b.toString(16) })
      i++
      continue
    }

    let ok = true
    for (let k = 1; k <= need; k++) {
      const c = buf[i + k]
      if (c === undefined) {
        errors.push({ at: i, sequenceStart: i, kind: "truncated", detail: "needs " + need + " continuation bytes, buffer ends" })
        ok = false
        break
      }
      if (c < low || c > high) {
        errors.push({ at: i + k, sequenceStart: i, kind: "bad-continuation", detail: "0x" + c.toString(16) + " outside 0x" + low.toString(16) + "-0x" + high.toString(16) })
        ok = false
        break
      }
      high = 0xbf; low = 0x80
    }
    if (!ok) { i++; continue } // resync on the next byte, like a real decoder
    multiByte++
    i += need + 1
  }
  return {
    ok: errors.length === 0,
    asciiBytes: ascii,
    sequences: ascii + multiByte,
    multiByte,
    errors: errors.slice(0, 64),
    errorCount: errors.length
  }
}

// Walk a buffer as UTF-16 code units and report how much of it looks like text.
export function analyzeUtf16 (buf, littleEndian) {
  if (buf.length < 2) {
    return { units: 0, aligned: true, plausibleRate: 0, surrogateErrors: 0, surrogateRate: 0, controlRate: 0, highZeroRatio: 0, kinds: {} }
  }
  const aligned = buf.length % 2 === 0
  const units = []
  let highZero = 0
  for (let i = 0; i + 1 < buf.length; i += 2) {
    if ((littleEndian ? buf[i + 1] : buf[i]) === 0) highZero++
    units.push(littleEndian ? (buf[i] | (buf[i + 1] << 8)) : ((buf[i] << 8) | buf[i + 1]))
  }
  const scored = scoreUnits(units, aligned)
  scored.highZeroRatio = units.length ? highZero / units.length : 0
  return scored
}

// Same, for UTF-32. Non-BMP code points are combined correctly.
export function analyzeUtf32 (buf, littleEndian) {
  if (buf.length < 4) {
    return { units: 0, aligned: true, plausibleRate: 0, surrogateErrors: 0, surrogateRate: 0, controlRate: 0, highZeroRatio: 0, kinds: {} }
  }
  const aligned = buf.length % 4 === 0
  const units = []
  let highZero = 0
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const b0 = buf[i]
    const b1 = buf[i + 1]
    const b2 = buf[i + 2]
    const b3 = buf[i + 3]
    // For a BMP code point three of the four bytes must be zero. Count how often
    // the three bytes above the least-significant one are all zero.
    const tail = littleEndian ? (b1 === 0 && b2 === 0 && b3 === 0) : (b0 === 0 && b1 === 0 && b2 === 0)
    if (tail) highZero++
    units.push(littleEndian
      ? ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0)
      : (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0))
  }
  const scored = scoreUnits(units, aligned)
  scored.highZeroRatio = units.length ? highZero / units.length : 0
  return scored
}

function scoreUnits (units, aligned) {
  let writing = 0
  let control = 0
  let surrogateErrors = 0
  const kinds = {}
  for (let i = 0; i < units.length; i++) {
    let u = units[i]
    // Fold valid surrogate pairs into one code point before classifying.
    if (u >= 0xd800 && u <= 0xdbff) {
      const next = units[i + 1]
      if (next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
        u = 0x10000 + ((u - 0xd800) << 10) + (next - 0xdc00)
        i++
      } else {
        surrogateErrors++
        kinds.surrogate = (kinds.surrogate || 0) + 1
        continue
      }
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      surrogateErrors++
      kinds.surrogate = (kinds.surrogate || 0) + 1
      continue
    }
    if (u > 0x10ffff) {
      kinds.invalid = (kinds.invalid || 0) + 1
      continue
    }
    const kind = classify(u)
    kinds[kind] = (kinds[kind] || 0) + 1
    if (isWriting(kind)) writing++
    if (kind === "control") control++
  }
  const n = units.length || 1
  return {
    units: units.length,
    aligned: aligned,
    plausibleRate: writing / n,
    surrogateErrors: surrogateErrors,
    surrogateRate: surrogateErrors / n,
    controlRate: control / n,
    kinds: kinds
  }
}

// Total code points in a decoded string, counting surrogate pairs once.
export function codePointLength (text) {
  let n = 0
  for (const ch of text) { if (ch) n++ }
  return n
}
