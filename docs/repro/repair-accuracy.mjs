// Reproduce the repair accuracy and false-positive tables in docs/evidence.md §5.
//
//   node docs/repro/repair-accuracy.mjs
//
// Requires the corpus: run docs/repro/fetch-corpus.sh first.
// Mojibake is always generated from bytes, never typed by hand: one wrong character
// changes every byte boundary and the test silently stops measuring anything.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import iconv from "../../lib/index-node.js"
import { repair } from "../../lib/probe/index.js"

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

const CORPUS = [
  { lang: "zh-hans", file: "loc-zh.json", re: /[\u4e00-\u9fff]/, chains: ["gb18030", "big5"] },
  { lang: "zh-hant", file: "loc-zht.json", re: /[\u4e00-\u9fff]/, chains: ["big5"] },
  { lang: "ja", file: "loc-ja.json", re: /[\u3040-\u30ff]/, chains: ["shiftjis"] },
  { lang: "ko", file: "loc-ko.json", re: /[\uac00-\ud7af]/, chains: ["euc-kr"] }
]

const N = 200
console.log("chain".padEnd(26) + pad("lossless-in", 13) + pad("recovered", 13) + pad("missed", 9) + pad("wrong", 8) + "already lost")
console.log("-".repeat(94))
const T = { ll: 0, ok: 0, miss: 0, wrong: 0, lost: 0 }

for (const c of CORPUS) {
  const strings = load(c.file, c.re)
  if (!strings) { console.log(`${c.lang}: corpus missing, skipped`); continue }
  for (const enc of c.chains) {
    let ll = 0; let ok = 0; let miss = 0; let wrong = 0; let lost = 0
    for (let k = 0; k < N; k++) {
      const orig = strings[(k * 7) % strings.length]
      const moj = iconv.decode(Buffer.from(orig, "utf8"), enc)
      if (moj === orig) continue
      if (moj.includes("\ufffd")) { lost++; continue }
      ll++
      const r = repair(moj)
      if (r.changed && r.text === orig) ok++
      else if (!r.changed) miss++
      else wrong++
    }
    T.ll += ll; T.ok += ok; T.miss += miss; T.wrong += wrong; T.lost += lost
    console.log(pad(`utf8 -> read as ${enc}`, 26) + pad(ll, 13) +
      pad(`${ok} ${ll ? (ok / ll * 100).toFixed(1) : 0}%`, 13) + pad(miss, 9) + pad(wrong, 8) + lost)
  }
}
console.log("-".repeat(94))
console.log(pad("TOTAL", 26) + pad(T.ll, 13) + pad(`${T.ok} ${(T.ok / T.ll * 100).toFixed(1)}%`, 13) + pad(T.miss, 9) + pad(T.wrong, 8) + T.lost)

console.log("\nlatin-1 family (always lossless)")
const zh = load("loc-zh.json", /[\u4e00-\u9fff]/)
for (const enc of ["iso-8859-1", "windows-1252"]) {
  let n = 0; let ok = 0; let miss = 0; let wrong = 0
  for (let k = 0; k < N; k++) {
    const orig = zh[(k * 7) % zh.length]
    const utf8 = Buffer.from(orig, "utf8")
    const moj = enc === "iso-8859-1" ? utf8.toString("latin1") : iconv.decode(utf8, enc)
    if (moj === orig) continue
    n++
    const r = repair(moj)
    if (r.changed && r.text === orig) ok++
    else if (!r.changed) miss++
    else wrong++
  }
  console.log(pad(`utf8 -> read as ${enc}`, 26) + `n=${n}  recovered=${ok} ${(ok / n * 100).toFixed(1)}%  missed=${miss}  wrong=${wrong}`)
}

console.log("\nfalse positives on already-correct text")
let fp = 0; let total = 0
for (const c of CORPUS) {
  const strings = load(c.file, c.re)
  if (!strings) continue
  let changed = 0; let n = 0
  for (let k = 0; k < N; k++) {
    const s = strings[(k * 7) % strings.length]
    n++
    const r = repair(s)
    if (r.changed) {
      if (changed === 0) console.log(`  FIRST WRONG: ${c.lang} ${JSON.stringify(s.slice(0, 30))} -> ${JSON.stringify(r.text.slice(0, 30))}`)
      changed++
    }
  }
  fp += changed; total += n
  console.log(`  ${pad(c.lang, 10)} changed ${changed}/${n}`)
}
console.log(`  TOTAL false positives ${fp}/${total}`)
