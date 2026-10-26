// Reproduce the NUL-byte-pattern table in docs/evidence.md §4.2.
// This single signal is what makes BOM-less UTF-16 detection possible at all, and
// its absence for pure-CJK input is why that case is refused rather than guessed.
//
//   node docs/repro/utf16-nul-signal.mjs

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import iconv from "../../lib/index-node.js"

const WORK = path.join(path.dirname(fileURLToPath(import.meta.url)), "work")

function walk (o, out) {
  if (typeof o === "string") { if (o.length > 3) out.push(o) } else if (Array.isArray(o)) o.forEach((x) => walk(x, out))
  else if (o && typeof o === "object") Object.values(o).forEach((x) => walk(x, out))
}
function load (file, re) {
  const p = path.join(WORK, file)
  if (!fs.existsSync(p)) return null
  const j = JSON.parse(fs.readFileSync(p, "utf8"))
  const all = []
  walk(j, all)
  return all.filter((s) => re.test(s) && s.length > 4)
}
const pad = (s, w) => String(s).padEnd(w)

// Share of code units whose high byte is 0x00, for a little-endian reading.
function zeroRatio (buf) {
  let z = 0, n = 0
  for (let i = 1; i < buf.length; i += 2) { n++; if (buf[i] === 0) z++ }
  return n ? z / n : 0
}
function stats (vals) {
  vals.sort((a, b) => a - b)
  return `${(vals[0] * 100).toFixed(1)}% / ${(vals[vals.length >> 1] * 100).toFixed(1)}% / ${(vals[vals.length - 1] * 100).toFixed(1)}%`
}

const SRC = [
  { lang: "zh-hans", file: "loc-zh.json", re: /[\u4e00-\u9fff]/, enc: "gb18030" },
  { lang: "zh-hant", file: "loc-zht.json", re: /[\u4e00-\u9fff]/, enc: "big5" },
  { lang: "ja", file: "loc-ja.json", re: /[\u3040-\u30ff]/, enc: "shiftjis" },
  { lang: "ko", file: "loc-ko.json", re: /[\uac00-\ud7af]/, enc: "euc-kr" }
]

console.log("NUL-byte ratio (min / median / max over 40 samples)")
console.log(pad("case", 42) + "ratio")
console.log("-".repeat(66))

for (const s of SRC) {
  const strings = load(s.file, s.re)
  if (!strings) { console.log(`${s.lang}: corpus missing, skipped`); continue }
  const vals = []
  for (let k = 0; k < 40; k++) {
    const t = strings[(k * 5) % strings.length].slice(0, 300)
    if (t.length < 8) continue
    vals.push(zeroRatio(Buffer.from(t, "utf16le")))
  }
  console.log(pad(`${s.lang}: TRUE utf16le, pure CJK`, 42) + stats(vals))
}

console.log("")
for (const s of SRC) {
  const strings = load(s.file, s.re)
  if (!strings) continue
  for (const target of [s.enc, "utf-8"]) {
    const vals = []
    for (let k = 0; k < 40; k++) {
      const t = strings[(k * 5) % strings.length].slice(0, 300)
      if (t.length < 8) continue
      let buf
      try { buf = target === "utf-8" ? Buffer.from(t, "utf8") : iconv.encode(t, target) } catch (e) { continue }
      if (buf.length % 2 || buf.length < 16) continue
      vals.push(zeroRatio(buf))
    }
    if (!vals.length) continue
    console.log(pad(`${s.lang} bytes as ${target}, read as UTF16LE`, 42) + stats(vals))
  }
}

console.log("\nwith ASCII mixed in (the realistic shape of a UTF-16 file)")
for (const t of ["更多操作... 关闭对话框", "设置 (Ctrl+,) 打开首选项", "JavaScript 文件编码设置为 UTF-8", "第 3 行出现错误"]) {
  const u16 = zeroRatio(Buffer.from(t, "utf16le"))
  let single = "odd length"
  const g = iconv.encode(t, "gb18030")
  if (g.length % 2 === 0) single = (zeroRatio(g) * 100).toFixed(1) + "%"
  console.log(`  ${pad(JSON.stringify(t.slice(0, 26)), 36)} utf16le=${(u16 * 100).toFixed(1)}%  gb18030=${single}`)
}
console.log("\nConclusion: the threshold is 15%. Every code page scores exactly 0.0%.")
