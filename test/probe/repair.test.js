import assert from "assert"
import { Buffer } from "buffer"
import iconv from "../../lib/index-node.js"
import { repair, looksLikeMojibake } from "../../lib/probe/repair.js"
import { analyze } from "../../lib/probe/detect.js"

const ZH = "更多操作 关闭对话框 正在进行 区分大小写 使用正则表达式"

// Build mojibake programmatically. Hand-typed mojibake is unreliable: the byte
// boundaries matter and a single wrong character changes the whole test.
function viaBuffer (text, as) {
  return iconv.decode(Buffer.from(text, "utf8"), as)
}
function viaLatin1 (text) {
  return Buffer.from(text, "utf8").toString("latin1")
}

describe("probe / repair", function () {
  it("undoes a Latin-1 mojibake with a lossless chain", function () {
    const moj = viaLatin1(ZH)
    assert.notEqual(moj, ZH)
    const r = repair(moj)
    assert.equal(r.changed, true)
    assert.equal(r.text, ZH)
    assert.equal(r.reversible, true)
    assert.equal(r.chain[0].then, "utf-8")
    assert.equal(r.chain[0].fidelity, 1)
  })

  it("undoes a GBK misread when no byte was lost", function () {
    // 24 UTF-8 bytes: an even count, so GBK's two-byte pairing loses nothing.
    // An odd byte count silently drops the last byte and is NOT recoverable —
    // see the next test and the README's "known limits".
    const src = "更多操作关闭对话"
    const moj = viaBuffer(src, "gb18030")
    assert.notEqual(moj, src)
    const r = repair(moj)
    assert.equal(r.changed, true)
    assert.equal(r.text, src)
    assert.equal(r.chain[0].as, "gb18030")
  })

  it("cannot recover a GBK misread of an odd-length byte stream, and says nothing false", function () {
    // 27 UTF-8 bytes: GBK pairs them into 13 characters and drops the last byte.
    const src = "正在进行区分大小写"
    assert.equal(Buffer.byteLength(src, "utf8") % 2, 1)
    const moj = viaBuffer(src, "gb18030")
    const r = repair(moj)
    // Either it refuses, or it produces something that is not the original.
    // It must never claim success: the byte is gone.
    assert.ok(r.changed === false || r.text !== src)
    if (r.changed) assert.notEqual(r.text, src)
  })

  it("improves a measurable quality score and reports it", function () {
    const r = repair(viaLatin1(ZH))
    assert.ok(r.quality.after > r.quality.before)
    assert.ok(r.quality.after > 0.9)
  })

  it("leaves correct text alone", function () {
    for (const s of [ZH, "plain english text", "日本語のテキストです。", "한국어 텍스트입니다."]) {
      const r = repair(s)
      assert.equal(r.changed, false, "should not touch " + JSON.stringify(s))
      assert.equal(r.text, s)
    }
  })

  it("refuses to repair input whose bytes were already dropped", function () {
    const damaged = viaBuffer(ZH, "gb18030") + "\ufffd"
    const r = repair(damaged)
    assert.equal(r.changed, false)
    assert.equal(r.reversible, false)
    assert.ok(r.damage.length > 0)
    assert.ok(r.damage[0].kind === "replacement-character")
    assert.ok(r.why.some(function (w) { return w.indexOf("cannot be inferred") !== -1 }))
  })

  it("explains that no repair is attempted and why", function () {
    const r = repair("nothing wrong here at all, just text")
    assert.equal(r.changed, false)
    assert.ok(r.why.length > 0)
  })

  it("decodes Buffer input directly when the encoding is determinable", function () {
    const r = repair(Buffer.from(ZH, "utf8"))
    assert.equal(r.input, "bytes")
    assert.equal(r.text, ZH)
    assert.equal(r.changed, false)
    assert.equal(r.encoding, "utf-8")
  })

  it("refuses to pick an encoding for ambiguous bytes", function () {
    const r = repair(iconv.encode("这是一段用于测试编码歧义的中文内容文本。", "gb18030"))
    assert.equal(r.input, "bytes")
    if (r.needsEncoding) {
      assert.equal(r.changed, false)
      assert.ok(r.why.some(function (w) { return w.indexOf("refusing to guess") !== -1 }))
      assert.ok(r.report)
    }
  })

  it("never returns a repaired string that is worse than the input", function () {
    const cases = [viaLatin1(ZH), viaBuffer(ZH, "gb18030"), ZH, "こんにちは世界", "Привет мир"]
    for (const c of cases) {
      const r = repair(c)
      if (r.changed && r.quality) assert.ok(r.quality.after > r.quality.before, JSON.stringify(c.slice(0, 20)))
    }
  })

  it("reports fidelity for a non-injective code page", function () {
    // U+20AC has two GBK byte forms, so a strict round trip can fail on text that
    // is nonetheless fully recoverable.
    const moj = viaBuffer(ZH + " \u20ac", "gb18030")
    const r = repair(moj)
    if (r.changed) assert.ok(r.chain[0].fidelity <= 1)
  })

  it("looksLikeMojibake flags C1 controls but not plain text", function () {
    assert.equal(looksLikeMojibake("\u009b\u009a"), true)
    assert.equal(looksLikeMojibake(ZH), false)
    assert.equal(looksLikeMojibake(""), false)
  })

  it("keeps the reported attempts bounded", function () {
    const r = repair(viaLatin1(ZH))
    assert.ok(r.attempts.length <= 20)
  })
})

describe("probe / repair across scripts", function () {
  const CASES = [
    { text: "这是一个中文测试字符串", as: "gb18030" },
    { text: "日本語のテスト文字列です", as: "shiftjis" },
    { text: "Это русский текст", as: "windows-1251" },
    { text: "Αυτό είναι ελληνικό κείμενο", as: "windows-1253" }
  ]

  for (const c of CASES) {
    it("does not damage already-correct " + c.as + " input", function () {
      const r = repair(c.text)
      assert.equal(r.changed, false, JSON.stringify(c.text))
    })
  }

  it("recovers a Latin-1 misread regardless of the underlying script", function () {
    for (const c of CASES) {
      const r = repair(viaLatin1(c.text))
      assert.equal(r.text, c.text, c.text)
    }
  })
})

describe("probe / analyze and repair agree", function () {
  it("analyze on a GBK byte stream and repair on the resulting string point the same way", function () {
    const bytes = iconv.encode(ZH, "gb18030")
    const report = analyze(bytes)
    assert.equal(report.verdict, "ambiguous")
    // The repair layer must not silently choose what analyze refused to choose.
    const r = repair(bytes)
    assert.equal(r.changed, false)
  })
})
