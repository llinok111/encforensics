// Reproduce the competitor baseline table in docs/evidence.md §2.
//
//   node docs/repro/baseline-compare.mjs
//
// Requires the corpus: run docs/repro/fetch-corpus.sh first.
// chardet and jschardet are not dependencies of this package; install them locally:
//   npm i --no-save chardet jschardet

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import iconv from "../../lib/index-node.js"

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORK = path.join(HERE, "work")

let chardet, jschardet
try {
  chardet = require("chardet")
  jschardet = require("jschardet")
} catch (e) {
  console.error("install the competitors first:  npm i --no-save chardet jschardet")
  process.exit(1)
}

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
  return re ? all.filter((s) => re.test(s)) : all
}

let seed = 20261026
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

function buildSamples (strings, targetLen, count) {
  const out = []
  let guard = 0
  while (out.length < count && guard++ < count * 40) {
    const start = Math.floor(rnd() * strings.length)
    let buf = ""
    for (let i = 0; i < 6 && buf.length < targetLen; i++) buf += (buf ? " " : "") + strings[(start + i) % strings.length].trim()
    if (buf.length >= targetLen * 0.85) out.push(buf.slice(0, targetLen))
  }
  return out
}

const ALIASES = {
  GB18030: ["gb18030", "gbk", "gb2312", "windows-936", "x-gbk"],
  Big5: ["big5", "big5-hkscs", "cp950", "windows-950"],
  Shift_JIS: ["shift_jis", "sjis", "windows-31j", "cp932", "x-sjis"],
  "EUC-JP": ["euc-jp", "eucjp"],
  "EUC-KR": ["euc-kr", "cp949", "windows-949"],
  "UTF-8": ["utf-8", "utf8"],
  "UTF-16LE": ["utf-16le", "utf16le", "utf-16"]
}
const norm = (e) => {
  if (!e) return String(e)
  const s = String(e).toLowerCase()
  for (const [k, v] of Object.entries(ALIASES)) if (v.includes(s)) return k
  return s
}

const CASES = [
  { lang: "zh-hans", file: "loc-zh.json", encs: ["GB18030", "UTF-8", "UTF-16LE", "Big5"] },
  { lang: "zh-hant", file: "loc-zht.json", encs: ["Big5", "GB18030", "UTF-8"] },
  { lang: "ja", file: "loc-ja.json", encs: ["Shift_JIS", "EUC-JP", "UTF-8"] },
  { lang: "ko", file: "loc-ko.json", encs: ["EUC-KR", "UTF-8"] }
]

const rows = []
for (const c of CASES) {
  const strings = load(c.file, /[\u3000-\u9fff\uac00-\ud7af]/)
  if (!strings) { console.log(`${c.lang}: corpus missing, skipped`); continue }
  for (const enc of c.encs) {
    for (const len of [16, 40, 120, 400]) {
      let n = 0, chOk = 0, jsOk = 0, chTop3 = 0
      for (const text of buildSamples(strings, len, 40)) {
        let buf
        try { buf = iconv.encode(text, enc) } catch (e) { continue }
        if (iconv.decode(buf, enc) !== text) continue
        n++
        const ch = (chardet.analyse(buf) || []).map((r) => norm(r.name))
        if (ch[0] === enc) chOk++
        if (ch.slice(0, 3).includes(enc)) chTop3++
        const js = jschardet.detect(buf, { minimumThreshold: 0 })
        if (js && norm(js.encoding) === enc) jsOk++
      }
      rows.push({ lang: c.lang, enc, len, n, chOk, chTop3, jsOk })
    }
  }
}

const pad = (s, w) => String(s).padEnd(w)
console.log(pad("lang", 8) + pad("encoding", 12) + pad("chars", 6) + pad("n", 5) + pad("chardet", 10) + pad("ch@3", 8) + "jschardet")
console.log("-".repeat(60))
const t = { n: 0, ch: 0, ch3: 0, js: 0 }
for (const r of rows) {
  t.n += r.n; t.ch += r.chOk; t.ch3 += r.chTop3; t.js += r.jsOk
  console.log(pad(r.lang, 8) + pad(r.enc, 12) + pad(r.len, 6) + pad(r.n, 5) +
    pad(`${r.chOk}/${r.n}`, 10) + pad(`${r.chTop3}/${r.n}`, 8) + `${r.jsOk}/${r.n}`)
}
console.log("-".repeat(60))
console.log("TOTAL".padEnd(31) + pad(t.n, 5) +
  pad(`${(t.ch / t.n * 100).toFixed(1)}%`, 10) + pad(`${(t.ch3 / t.n * 100).toFixed(1)}%`, 8) + `${(t.js / t.n * 100).toFixed(1)}%`)
