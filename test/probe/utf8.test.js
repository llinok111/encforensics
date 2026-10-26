import assert from "assert"
import { Buffer } from "buffer"
import { validateUtf8, analyzeUtf16, analyzeUtf32 } from "../../lib/probe/unicode-validate.js"
import { classify, naturalness } from "../../lib/probe/blocks.js"

describe("probe / UTF-8 structural validation", function () {
  it("accepts ASCII", function () {
    const r = validateUtf8(Buffer.from("hello world", "latin1"))
    assert.equal(r.ok, true)
    assert.equal(r.multiByte, 0)
    assert.equal(r.asciiBytes, 11)
  })

  it("accepts multi-byte sequences and counts them", function () {
    const r = validateUtf8(Buffer.from("更多操作", "utf8"))
    assert.equal(r.ok, true)
    assert.equal(r.multiByte, 4)
  })

  it("accepts a 4-byte sequence", function () {
    const r = validateUtf8(Buffer.from("\u{1f600}", "utf8"))
    assert.equal(r.ok, true)
    assert.equal(r.multiByte, 1)
  })

  it("rejects an invalid lead byte and reports its offset", function () {
    const r = validateUtf8(Buffer.from([0x41, 0xff, 0x42]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].at, 1)
    assert.equal(r.errors[0].kind, "invalid-lead")
  })

  it("rejects a stray continuation byte", function () {
    const r = validateUtf8(Buffer.from([0x41, 0x80, 0x42]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].at, 1)
    assert.equal(r.errors[0].kind, "stray-continuation")
  })

  it("rejects a truncated sequence at the end of the buffer", function () {
    const r = validateUtf8(Buffer.from([0x41, 0xe6, 0x9b]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].kind, "truncated")
  })

  it("rejects overlong forms (C0/C1 lead bytes)", function () {
    const r = validateUtf8(Buffer.from([0xc0, 0xaf]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].kind, "overlong-lead")
  })

  it("rejects an overlong E0 80 sequence", function () {
    const r = validateUtf8(Buffer.from([0xe0, 0x80, 0xaf]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].kind, "bad-continuation")
  })

  it("rejects encoded surrogates (ED A0 80)", function () {
    const r = validateUtf8(Buffer.from([0xed, 0xa0, 0x80]))
    assert.equal(r.ok, false)
    assert.equal(r.errors[0].kind, "bad-continuation")
  })

  it("rejects code points above U+10FFFF (F4 90 80 80)", function () {
    const r = validateUtf8(Buffer.from([0xf4, 0x90, 0x80, 0x80]))
    assert.equal(r.ok, false)
  })

  it("accepts the largest legal code point U+10FFFF", function () {
    const r = validateUtf8(Buffer.from([0xf4, 0x8f, 0xbf, 0xbf]))
    assert.equal(r.ok, true)
  })

  it("resynchronises after an error instead of aborting", function () {
    // bad byte, then a valid 3-byte sequence
    const r = validateUtf8(Buffer.from([0xff, 0xe6, 0x9b, 0xb4]))
    assert.equal(r.ok, false)
    assert.equal(r.errors.length, 1)
    assert.equal(r.multiByte, 1)
  })

  it("caps the reported error list", function () {
    const buf = Buffer.alloc(500, 0xff)
    const r = validateUtf8(buf)
    assert.equal(r.errorCount, 500)
    assert.ok(r.errors.length <= 64)
  })

  it("never reports an error on a long valid buffer", function () {
    const r = validateUtf8(Buffer.from("汉字abc\u{1f600}カタカナ한글", "utf8"))
    assert.equal(r.ok, true)
  })
})

describe("probe / UTF-16 plausibility", function () {
  it("scores real UTF-16LE CJK text at 100%", function () {
    const r = analyzeUtf16(Buffer.from("这是一段用于测试的中文文本内容", "utf16le"), true)
    assert.equal(r.aligned, true)
    assert.equal(r.plausibleRate, 1)
    assert.equal(r.surrogateErrors, 0)
  })

  it("prefers the right endianness", function () {
    const buf = Buffer.from("这是一段用于测试的中文文本内容", "utf16le")
    const le = analyzeUtf16(buf, true)
    const be = analyzeUtf16(buf, false)
    assert.ok(le.plausibleRate > be.plausibleRate, `le=${le.plausibleRate} be=${be.plausibleRate}`)
  })

  it("flags lone surrogates", function () {
    const r = analyzeUtf16(Buffer.from([0x00, 0xd8, 0x41, 0x00]), true)
    assert.equal(r.surrogateErrors, 1)
  })

  it("handles a valid surrogate pair without counting an error", function () {
    const buf = Buffer.from("\u{1f600}", "utf16le")
    const r = analyzeUtf16(buf, true)
    assert.equal(r.surrogateErrors, 0)
    assert.equal(r.units, 2)
  })

  it("reports an odd length as misaligned", function () {
    const r = analyzeUtf16(Buffer.from([0x41, 0x00, 0x42]), true)
    assert.equal(r.aligned, false)
  })

  it("scores UTF-32LE text at 100%", function () {
    const t = "测试文本内容"
    const buf = Buffer.alloc(t.length * 4)
    let p = 0
    for (const ch of t) buf.writeUInt32LE(ch.codePointAt(0), (p += 4) - 4)
    const r = analyzeUtf32(buf, true)
    assert.equal(r.plausibleRate, 1)
  })

  it("reports UTF-32 as unaligned when the length is not a multiple of four", function () {
    const r = analyzeUtf32(Buffer.from([1, 2, 3, 4, 5]), true)
    assert.equal(r.aligned, false)
  })
})

describe("probe / block classification", function () {
  it("classifies representative code points", function () {
    assert.equal(classify(0x41), "ascii")
    assert.equal(classify(0x00e9), "latin")
    assert.equal(classify(0x00a9), "symbol") // © is a Latin-1 symbol, not a letter
    assert.equal(classify(0x009b), "control") // C1 control: the latin1-misread signature
    assert.equal(classify(0x4e2d), "cjk")
    assert.equal(classify(0x3042), "hiragana")
    assert.equal(classify(0xac00), "hangul")
    assert.equal(classify(0xe000), "pua")
    assert.equal(classify(0xfffd), "replacement")
    assert.equal(classify(0xd800), "surrogate")
    assert.equal(classify(0x110000), "invalid")
  })

  it("scores real text at 1.0 and control debris at 0", function () {
    assert.equal(naturalness("这是一段正常的中文文本").score, 1)
    assert.equal(naturalness("\u0001\u0002\u0003").score, 0)
  })

  it("treats the CJK extension blocks as non-writing", function () {
    // Wrong decodes land here constantly, so counting them as writing would let
    // mojibake score as high as real text.
    const r = naturalness("\u3400\u3401\u3402\u3403")
    assert.equal(r.score, 0)
  })

  it("reports the dominant script but ignores punctuation for it", function () {
    const r = naturalness("中文，中文。中文")
    assert.equal(r.dominant, "cjk")
    assert.equal(r.dominance, 1)
  })

  it("computes dominance across mixed scripts", function () {
    const r = naturalness("中文中文中文カタ")
    assert.equal(r.dominant, "cjk")
    assert.equal(r.dominance, 0.75) // 6 han characters out of 8 script characters
  })

  it("returns a zero score for an empty string", function () {
    const r = naturalness("")
    assert.equal(r.score, 0)
    assert.equal(r.total, 0)
    assert.equal(r.dominant, null)
  })
})
