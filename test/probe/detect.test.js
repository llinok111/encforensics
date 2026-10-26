import assert from "assert"
import { Buffer } from "buffer"
import iconv from "../../lib/index-node.js"
import { analyze } from "../../lib/probe/detect.js"
import { locate, decodeBest } from "../../lib/probe/index.js"
import { commonness, bestCommonness, textQuality } from "../../lib/probe/commonness.js"
import { roundTrip, canEncode, firstLossyOffset } from "../../lib/probe/charset.js"

const ZH = "这是一段正常的中文文本，用来验证编码判定与修复行为。"

describe("probe / analyze", function () {
  it("reports empty input", function () {
    const r = analyze(Buffer.alloc(0))
    assert.equal(r.verdict, "empty")
  })

  it("requires a Buffer or string", function () {
    assert.throws(function () { analyze(42) }, TypeError)
  })

  it("detects a UTF-8 BOM with certainty", function () {
    const r = analyze(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ZH, "utf8")]))
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "utf-8")
    assert.equal(r.bom.label, "UTF-8")
    assert.equal(r.preview.indexOf("\ufeff"), -1) // BOM stripped from the preview
  })

  it("detects a UTF-16LE BOM", function () {
    const r = analyze(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ZH, "utf16le")]))
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "utf-16le")
  })

  it("detects a UTF-16BE BOM", function () {
    const r = analyze(Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(ZH, "utf16be")]))
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "utf-16be")
  })

  it("prefers the UTF-32LE BOM over the UTF-16LE BOM it starts with", function () {
    const body = Buffer.alloc(ZH.length * 4)
    let p = 0
    for (const ch of ZH) body.writeUInt32LE(ch.codePointAt(0), (p += 4) - 4)
    const r = analyze(Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), body]))
    assert.equal(r.encoding, "utf-32le")
  })

  it("recognises pure ASCII", function () {
    const r = analyze(Buffer.from("plain ascii text\n"))
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "ascii")
  })

  it("recognises valid multi-byte UTF-8", function () {
    const r = analyze(Buffer.from(ZH, "utf8"))
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "utf-8")
    assert.ok(r.why.some(function (w) { return w.indexOf("well-formed") !== -1 }))
  })

  it("does not claim UTF-8 for a byte stream that is not UTF-8", function () {
    const r = analyze(iconv.encode(ZH, "gb18030"))
    assert.notEqual(r.encoding, "utf-8")
  })

  // BOM-less UTF-16 is only claimed when the NUL-byte pattern proves it, which
  // requires the text to contain ASCII. Pure-CJK UTF-16 is indistinguishable
  // from a legacy encoding and is deliberately refused.
  const MIXED = "更多操作 <b>bold</b> 关闭 Ctrl+Shift+P 设置 = 1"

  it("detects BOM-less UTF-16LE when the NUL pattern proves it", function () {
    const r = analyze(Buffer.from(MIXED, "utf16le"))
    assert.equal(r.verdict, "probable")
    assert.equal(r.encoding, "utf-16le")
    assert.ok(r.why.some(function (w) { return w.indexOf("NUL bytes") !== -1 }))
  })

  it("detects BOM-less UTF-16BE", function () {
    const r = analyze(iconv.encode(MIXED, "utf16be"))
    assert.equal(r.verdict, "probable")
    assert.equal(r.encoding, "utf-16be")
  })

  it("refuses to guess pure-CJK BOM-less UTF-16 and explains why", function () {
    const r = analyze(Buffer.from(ZH, "utf16le"))
    assert.notEqual(r.encoding, "utf-16le")
    assert.ok(r.notes.some(function (n) { return n.indexOf("indistinguishable") !== -1 }), JSON.stringify(r.notes))
  })

  it("refuses a UTF-16 verdict when the sample is too short", function () {
    // 3 code units: below the threshold, so the honest answer is "not enough evidence".
    const r = analyze(Buffer.from("中文文", "utf16le"))
    assert.notEqual(r.encoding, "utf-16le")
    assert.ok(r.notes.some(function (n) { return n.indexOf("threshold") !== -1 }))
  })

  it("does not mistake GBK bytes for UTF-16", function () {
    const r = analyze(iconv.encode(ZH, "gb18030"))
    assert.ok(r.encoding !== "utf-16be" && r.encoding !== "utf-16le", "wrongly classified as " + r.encoding)
  })

  it("returns ambiguous, not a guess, for GBK bytes", function () {
    const r = analyze(iconv.encode(ZH, "gb18030"))
    assert.equal(r.verdict, "ambiguous")
    assert.equal(r.encoding, null)
    assert.ok(r.candidates.length > 1)
    assert.ok(r.why.some(function (w) { return w.indexOf("cannot separate") !== -1 }))
    assert.ok(r.hint, "a hint is offered but clearly labelled")
  })

  it("never returns a single-byte codec whose output is symbol soup", function () {
    const r = analyze(iconv.encode(ZH, "gb18030"))
    for (const c of r.candidates) {
      if (c.family === "sbcs") assert.ok(c.naturalness >= 0.9, c.encoding + " naturalness " + c.naturalness)
    }
  })

  it("reports binary for random bytes", function () {
    const buf = Buffer.alloc(512)
    let seed = 7
    for (let i = 0; i < buf.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; buf[i] = (seed >> 16) & 0xff }
    const r = analyze(buf)
    assert.ok(r.verdict === "binary" || r.verdict === "unknown", r.verdict)
  })

  it("analyses a string as text-only and points at repair()", function () {
    const r = analyze(ZH)
    assert.equal(r.kind, "text")
    assert.equal(r.verdict, "text-only")
    assert.ok(r.why.some(function (w) { return w.indexOf("repair()") !== -1 }))
  })

  it("reports the UTF-8 error offset inside the unicode section", function () {
    const r = analyze(Buffer.from([0x41, 0x42, 0xff, 0x43]))
    assert.equal(r.unicode.utf8.ok, false)
    assert.equal(r.unicode.utf8.errors[0].at, 2)
  })
})

describe("probe / charset round trip", function () {
  it("accepts a lossless pair", function () {
    const buf = iconv.encode("hello", "windows-1252")
    assert.equal(roundTrip(buf, "windows-1252").lossless, true)
  })

  it("rejects a stream with bytes the codec cannot represent", function () {
    const r = roundTrip(Buffer.from([0x81, 0x40]), "windows-1252")
    assert.ok(r === null || r.lossless === false)
  })

  it("returns null for an unknown encoding", function () {
    assert.equal(roundTrip(Buffer.from("x"), "no-such-encoding"), null)
    assert.equal(canEncode("no-such-encoding"), false)
    assert.equal(canEncode("gb18030"), true)
  })

  it("locates the first lossy byte for a legacy codec", function () {
    // Valid GBK for two characters, then a byte that cannot follow.
    const buf = Buffer.from([0xb8, 0xfc, 0xb6, 0xe0, 0xff, 0xff])
    const r = firstLossyOffset(buf, "gb18030")
    assert.ok(r.at >= 0)
    assert.ok(r.calls > 0)
  })

  it("reports -1 when everything is reproducible", function () {
    const buf = iconv.encode(ZH, "gb18030")
    assert.equal(firstLossyOffset(buf, "gb18030").at, -1)
  })
})

describe("probe / locate", function () {
  it("points at the exact byte for UTF-8", function () {
    const r = locate(Buffer.from([0x61, 0xe6, 0x9b, 0x62]), "utf-8")
    assert.equal(r.ok, false)
    assert.equal(r.at, 3) // the byte that is actually wrong
    assert.equal(r.errors[0].sequenceStart, 1) // where the broken sequence began
    assert.ok(r.context)
  })

  it("returns ok for valid input", function () {
    const r = locate(Buffer.from(ZH, "utf8"), "utf-8")
    assert.equal(r.ok, true)
    assert.equal(r.at, -1)
  })

  it("finds damage in a legacy encoding", function () {
    const r = locate(Buffer.from([0xb8, 0xfc, 0xff, 0xff]), "gb18030")
    assert.equal(r.ok, false)
    assert.ok(r.at >= 0)
  })

  it("throws on an unknown encoding", function () {
    assert.throws(function () { locate(Buffer.from("x"), "no-such-encoding") })
  })
})

describe("probe / commonness", function () {
  it("scores ordinary simplified Chinese at 100% under GB18030", function () {
    const r = commonness("这是一段正常的中文文本用来验证", "gb18030")
    assert.equal(r.rate, 1)
    assert.equal(r.considered, r.encodable)
  })

  it("scores a GBK misread far below the original", function () {
    const original = "这是一段正常的中文文本用来验证判定行为"
    const mojibake = iconv.decode(Buffer.from(original, "utf8"), "gb18030")
    const good = commonness(original, "gb18030")
    const bad = commonness(mojibake, "gb18030")
    assert.ok(good.rate > bad.rate, `good=${good.rate} bad=${bad.rate}`)
    assert.ok(good.rate - bad.rate > 0.3, `margin ${good.rate - bad.rate}`)
  })

  it("returns null when there is no hanzi or hangul", function () {
    assert.equal(commonness("plain latin text", "gb18030"), null)
    assert.equal(bestCommonness("plain latin text"), null)
  })

  it("ignores a standard that can barely encode the text", function () {
    // Japanese kana are absent from GB18030's double-byte plane; a rate built on
    // two encodable characters out of many is not evidence.
    const r = commonness("あいうえおかきくけこさしすせそ", "gb18030")
    assert.ok(r === null || r.encodable < r.considered)
  })

  it("combines naturalness and commonness into one comparable number", function () {
    const good = textQuality("这是一段正常的中文文本")
    const debris = textQuality("\u0001\u0002\u0003\u0004")
    assert.ok(good.score > debris.score)
    assert.equal(good.commonness, 1)
  })
})

describe("probe / decodeBest", function () {
  it("decodes UTF-8 input", function () {
    const r = decodeBest(Buffer.from(ZH, "utf8"))
    assert.equal(r.text, ZH)
    assert.equal(r.report.encoding, "utf-8")
  })

  it("always returns a string, even for unusable input", function () {
    const r = decodeBest(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]))
    assert.equal(typeof r.text, "string")
  })
})
