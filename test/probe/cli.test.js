import assert from "assert"
import { Buffer } from "buffer"
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import iconv from "../../lib/index-node.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, "../../bin/encprobe.js")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "encprobe-test-"))

function run (args, input) {
  try {
    const stdout = execFileSync(process.execPath, [CLI].concat(args), {
      input: input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    })
    return { code: 0, stdout: stdout, stderr: "" }
  } catch (e) {
    return { code: e.status === null ? -1 : e.status, stdout: e.stdout || "", stderr: e.stderr || "" }
  }
}

function write (name, buf) {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, buf)
  return p
}

const ZH = "更多操作关闭对话"

describe("probe / CLI", function () {
  after(function () {
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* best effort */ }
  })

  it("prints usage with --help and exits 0", function () {
    const r = run(["--help"])
    assert.equal(r.code, 0)
    assert.ok(r.stdout.indexOf("encprobe") !== -1)
    assert.ok(r.stdout.indexOf("Exit codes") !== -1)
  })

  it("exits 3 on an unknown option", function () {
    const r = run(["--nope"])
    assert.equal(r.code, 3)
  })

  it("exits 2 on an empty file", function () {
    const p = write("empty.bin", Buffer.alloc(0))
    const r = run([p])
    assert.equal(r.code, 2)
  })

  it("exits 0 and names the encoding for valid UTF-8", function () {
    const p = write("utf8.txt", Buffer.from(ZH, "utf8"))
    const r = run([p])
    assert.equal(r.code, 0)
    assert.ok(r.stdout.indexOf("UTF-8") !== -1)
    assert.ok(r.stdout.indexOf("certain") !== -1)
  })

  it("exits 1 for ambiguous legacy bytes and lists candidates", function () {
    const p = write("gbk.txt", iconv.encode("这是一段用于测试编码歧义判定行为的中文内容文本。", "gb18030"))
    const r = run([p])
    assert.equal(r.code, 1)
    assert.ok(r.stdout.indexOf("ambiguous") !== -1)
    assert.ok(r.stdout.indexOf("candidates") !== -1)
  })

  it("emits parseable JSON with --json", function () {
    const p = write("utf8b.txt", Buffer.from(ZH, "utf8"))
    const r = run([p, "--json"])
    assert.equal(r.code, 0)
    const j = JSON.parse(r.stdout)
    assert.equal(j.verdict, "certain")
    assert.equal(j.encoding, "utf-8")
    assert.ok(Array.isArray(j.why))
  })

  it("reads from stdin with --stdin", function () {
    const r = run(["--stdin", "--quiet"], Buffer.from(ZH, "utf8"))
    assert.equal(r.code, 0)
    assert.ok(r.stdout.trim().indexOf("utf-8") !== -1)
  })

  it("repairs a mojibake file with --repair", function () {
    const moj = Buffer.from(Buffer.from(ZH, "utf8").toString("latin1"), "utf8")
    const p = write("moj.txt", moj)
    const r = run([p, "--repair"])
    assert.equal(r.code, 0)
    assert.ok(r.stdout.indexOf(ZH) !== -1, "got: " + JSON.stringify(r.stdout))
  })

  it("writes the repair to a file with --write", function () {
    const moj = Buffer.from(Buffer.from(ZH, "utf8").toString("latin1"), "utf8")
    const p = write("moj2.txt", moj)
    const out = path.join(TMP, "fixed.txt")
    const r = run([p, "--repair", "--write", out])
    assert.equal(r.code, 0)
    assert.equal(fs.readFileSync(out, "utf8"), ZH)
  })

  it("locates a bad UTF-8 byte", function () {
    const p = write("bad.bin", Buffer.from([0x61, 0xe6, 0x9b, 0x62]))
    const r = run([p, "--locate", "--encoding", "utf-8"])
    assert.equal(r.code, 2)
    assert.ok(r.stdout.indexOf("first bad") !== -1)
    assert.ok(r.stdout.indexOf("byte 3") !== -1)
  })

  it("reports ok with --locate for clean input", function () {
    const p = write("good.bin", Buffer.from(ZH, "utf8"))
    const r = run([p, "--locate"])
    assert.equal(r.code, 0)
    assert.ok(r.stdout.indexOf("every byte is valid") !== -1)
  })

  it("exits 2 for random binary data", function () {
    const buf = Buffer.alloc(1024)
    let seed = 99
    for (let i = 0; i < buf.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; buf[i] = (seed >> 16) & 0xff }
    const p = write("rand.bin", buf)
    const r = run([p, "--quiet"])
    assert.ok(r.code === 2, "exit " + r.code)
  })

  it("honours --sample by truncating the read", function () {
    const big = Buffer.concat([Buffer.from(ZH, "utf8"), Buffer.alloc(4096, 0x41)])
    const p = write("big.bin", big)
    const r = run([p, "--sample", "48", "--json"])
    const j = JSON.parse(r.stdout)
    assert.equal(j.bytes, 48)
  })
})
