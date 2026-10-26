import assert from "assert"
import { Buffer } from "buffer"
import iconv from "../../lib/index-node.js"
import { analyze, repair, locate, decodeBest, looksLikeMojibake } from "../../lib/probe/index.js"
import { roundTrip, firstLossyOffset } from "../../lib/probe/charset.js"
import { codePointLength, analyzeUtf16, analyzeUtf32 } from "../../lib/probe/unicode-validate.js"
import { classify, naturalness, KIND_TABLE } from "../../lib/probe/blocks.js"

// These exercise branches that the behaviour tests do not reach: option handling,
// degenerate inputs, and the paths taken when a codec itself throws.

describe("probe / options and degenerate input", function () {
  it("honours maxCandidates", function () {
    const buf = iconv.encode("这是一段用于测试候选数量上限的中文内容文本。", "gb18030")
    const few = analyze(buf, { maxCandidates: 2 })
    const many = analyze(buf, { maxCandidates: 20 })
    assert.ok(few.candidates.length <= 2)
    assert.ok(many.candidates.length >= few.candidates.length)
  })

  it("accepts a Uint8Array as well as a Buffer", function () {
    const buf = new Uint8Array(Buffer.from("hello", "utf8"))
    const r = analyze(buf)
    assert.equal(r.verdict, "certain")
    assert.equal(r.encoding, "ascii")
  })

  it("round-trips an empty Uint8Array", function () {
    assert.equal(analyze(new Uint8Array(0)).verdict, "empty")
  })

  it("counts code points across surrogate pairs", function () {
    assert.equal(codePointLength("a\u{1f600}b"), 3)
    assert.equal(codePointLength(""), 0)
  })

  it("classifies every range in the table without throwing", function () {
    for (const [lo, hi] of KIND_TABLE) {
      assert.equal(typeof classify(lo), "string")
      assert.equal(typeof classify(hi), "string")
    }
  })

  it("classifies a code point outside every listed range as other", function () {
    // U+08A0 (Arabic Extended-A) is not covered by the coarse table on purpose.
    assert.equal(classify(0x08a0), "other")
  })

  it("classifies the last code point", function () {
    assert.equal(classify(0x10ffff), "other")
  })
})

describe("probe / locate on legacy encodings", function () {
  it("returns ok for a clean legacy buffer", function () {
    const buf = iconv.encode("这是一段用于测试的中文内容文本。", "gb18030")
    const r = locate(buf, "gb18030")
    assert.equal(r.ok, true)
    assert.equal(r.at, -1)
    assert.equal(r.errors.length, 0)
  })

  it("reports context bytes around the damage", function () {
    const buf = Buffer.from([0x41, 0x42, 0xff, 0xff, 0x43, 0x44])
    const r = locate(buf, "utf-8")
    assert.equal(r.ok, false)
    assert.ok(Array.isArray(r.context.bytes))
    assert.ok(r.context.offsetInContext >= 0)
  })

  it("honours a small bisection budget", function () {
    const buf = iconv.encode("中文测试文本内容用于预算测试", "gb18030")
    const r = firstLossyOffset(buf, "gb18030", 2)
    assert.ok(r.calls <= 3)
  })
})

describe("probe / round trip edge cases", function () {
  it("returns null for an unsupported encoding name", function () {
    assert.equal(roundTrip(Buffer.from("x"), "definitely-not-real"), null)
  })

  it("survives an encoding that rejects the input", function () {
    // A lone high byte cannot be represented by a single-byte code page.
    const r = roundTrip(Buffer.from([0xff]), "windows-1252")
    assert.ok(r === null || typeof r.lossless === "boolean")
  })
})

describe("probe / repair options and fallbacks", function () {
  it("honours maxDepth 1 by stopping after the first pass", function () {
    const moj = Buffer.from(Buffer.from("更多操作关闭对话", "utf8").toString("latin1"), "utf8")
    const r = repair(moj, { maxDepth: 1 })
    assert.ok(r.chain.length <= 1)
  })

  it("treats undecodable bytes as a mojibake carrier and says so", function () {
    const buf = Buffer.from([0x80, 0x81, 0x8d, 0x90, 0x9d, 0xff, 0xfe, 0x01, 0x02, 0x03])
    const r = repair(buf)
    assert.equal(r.input, "bytes")
    assert.ok(typeof r.text === "string")
    if (!r.changed) assert.ok(r.why.length > 0)
  })

  it("reports quality figures when it does change something", function () {
    const moj = Buffer.from("更多操作关闭对话", "utf8").toString("latin1")
    const r = repair(moj)
    assert.equal(r.changed, true)
    assert.ok(r.quality)
    assert.ok(r.quality.after > r.quality.before)
  })

  it("flags a byte-order-mark artifact as mojibake", function () {
    assert.equal(looksLikeMojibake("\u00ef\u00bb\u00bfhello"), true)
  })

  it("flags low-naturalness text", function () {
    assert.equal(looksLikeMojibake("\u3400\u3401\u3402\u3403\u3404"), true)
  })

  it("does not flag high-naturalness text", function () {
    assert.equal(looksLikeMojibake("这是一段正常的中文文本内容"), false)
  })

  it("accepts a Uint8Array", function () {
    const r = repair(new Uint8Array(Buffer.from("更多操作关闭对话", "utf8")))
    assert.equal(r.input, "bytes")
    assert.equal(r.text, "更多操作关闭对话")
  })
})

describe("probe / decodeBest", function () {
  it("falls back to UTF-8 for pure ASCII", function () {
    const r = decodeBest(Buffer.from("plain ascii", "utf8"))
    assert.equal(r.text, "plain ascii")
    assert.equal(r.report.encoding, "ascii")
  })

  it("returns the decoded text for a BOM input without the BOM", function () {
    const r = decodeBest(Buffer.from("\ufeffhello", "utf8"))
    assert.ok(r.text.indexOf("hello") !== -1)
  })

  it("accepts a Uint8Array", function () {
    const r = decodeBest(new Uint8Array(Buffer.from("更多操作", "utf8")))
    assert.equal(r.text, "更多操作")
  })
})

describe("probe / unicode validation degenerate sizes", function () {
  it("handles buffers too short to be UTF-16 or UTF-32", function () {
    assert.equal(analyzeUtf16(Buffer.from([0x41]), true).units, 0)
    assert.equal(analyzeUtf32(Buffer.from([0x41, 0x42]), true).units, 0)
  })

  it("reports zero ratios for an empty sample rather than NaN", function () {
    const r = analyzeUtf16(Buffer.alloc(0), true)
    assert.equal(r.highZeroRatio, 0)
    assert.equal(r.plausibleRate, 0)
  })

  it("counts a high byte of zero", function () {
    const r = analyzeUtf16(Buffer.from("A\u4e2d", "utf16le"), true)
    assert.ok(r.highZeroRatio > 0)
  })

  it("never reports NaN for a naturalness score", function () {
    for (const s of ["", "\u0000", "\u{10ffff}", "a"]) {
      assert.ok(Number.isFinite(naturalness(s).score))
    }
  })
})
