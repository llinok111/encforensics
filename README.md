# encforensics

Character-encoding forensics for Node.js — **determine, explain, and repair** text
encodings. Built on top of [`iconv-lite`](https://github.com/pillarjs/iconv-lite), whose
conversion tables it reuses, and whose author declined this feature in 2015:

> **issue #41 — "how to detect encoding?"** → `ashtuchkin`: **"No, sorry."**

`encforensics` is the layer `iconv-lite` deliberately never grew: it does not convert
encodings, it tells you **which encoding a byte stream is**, **why**, and **what to do
when the text has already been mis-decoded**.

```console
$ encprobe exported-from-excel.csv
file      : exported-from-excel.csv
bytes     : 8412
verdict   : ambiguous
why       :
  - no BOM, and the bytes are not valid multi-byte UTF-8
  - 5 legacy encodings each reproduce the input byte-for-byte: GB18030, Big5, ...
  - byte-level evidence cannot separate them — the same bytes decode to different
    but equally well-formed text; a statistical language model would be required
candidates (all reproduce the input byte-for-byte):
  - GB18030   naturalness=1 dominance=1  dominant=cjk
  - Big5      naturalness=1 dominance=1  dominant=cjk
```

That output is the point: **it refuses to guess.** `chardet` would have answered
`Big5, confidence 0.73` and been wrong 1 time in 8.

---

## What actually works

Every claim below is measured; the numbers come from scripts described in
[`docs/evidence.md`](docs/evidence.md).

| Capability | Certainty |
|---|---|
| BOM detection (UTF-8/16/32, all five forms) | **deterministic** |
| ASCII / empty / binary classification | **deterministic** |
| UTF-8 structural validation, with byte offset and reason | **deterministic** |
| BOM-less UTF-16/32 detection (text that contains ASCII) | **high confidence**, NUL-pattern based |
| Mojibake detection and lossless recovery | **deterministic** (round-trip verified) |
| Locating the first byte an encoding cannot explain | **deterministic** |
| BOM-less UTF-16 of *pure* CJK text | **refused** — indistinguishable from a legacy code page |
| GBK vs Big5 vs Shift_JIS vs EUC-KR single choice | **refused** — needs a language model |

### Measured behaviour

Repair accuracy, generated from `microsoft/vscode-loc` (MIT, human translations),
200 samples per chain, mojibake always produced programmatically:

| Chain | Recoverable inputs | Recovered | Wrong result |
|---|---|---|---|
| UTF-8 bytes read as ISO-8859-1 | 200 | **200 (100%)** | 0 |
| UTF-8 bytes read as GB18030 | 48 | **38 (79.2%)** | 0 |
| UTF-8 bytes read as Shift_JIS | 19 | **13 (68.4%)** | 0 |
| UTF-8 bytes read as Big5 | 5 | **5 (100%)** | 0 |
| **Already-correct text (all four languages)** | 800 | — | **0 changed** |

False positives are the number that matters most for a tool like this, and it is zero
on 800 samples of correct Simplified Chinese, Traditional Chinese, Japanese and Korean.

The 152 GB18030 inputs that are *not* in the table were already destroyed before
`repair()` ran: the wrong decode left `U+FFFD` behind. `encforensics` detects that and
refuses to invent bytes.

---

## Install and use

```console
npm install encforensics
```

### CLI

```console
encprobe <file>                      # what is this?
encprobe <file> --json               # machine-readable
encprobe <file> --repair             # undo mojibake, print the result
encprobe <file> --repair --write out # write it to a file
encprobe <file> --locate             # first byte that UTF-8 cannot explain
cat file | encprobe --stdin          # read from a pipe
```

Exit codes are part of the interface:

| Code | Meaning |
|---|---|
| `0` | one encoding determined |
| `1` | several fit, no evidence to separate them |
| `2` | no usable answer (binary, unknown, empty) |
| `3` | usage error |

### Library

```javascript
import { analyze, repair, locate } from "encforensics/probe"

const report = analyze(buffer)
// {
//   verdict: "certain" | "probable" | "ambiguous" | "binary" | "empty" | "text-only",
//   encoding: "utf-8" | null,
//   confidence: 0.99,
//   bom: { encoding, label, length, bytes },
//   why: ["all 32 UTF-8 sequences are well-formed (25 multi-byte)", ...],
//   candidates: [{ encoding, label, naturalness, dominance, losslessRoundTrip }],
//   notes: [...],
//   preview: "…"
// }

const fixed = repair("æ´å¤æä½œ")
// { changed: true, text: "更多操作", chain: [{ as: "iso-8859-1", then: "utf-8", fidelity: 1 }],
//   reversible: true, damage: [], quality: { before: 0.419, after: 1 } }

locate(buffer, "utf-8")
// { ok: false, at: 3, errors: [{ at: 3, sequenceStart: 1, kind: "bad-continuation" }] }
```

The original `iconv-lite` API (`encode`, `decode`, `encodingExists`, streams, browser
backend) is unchanged and still exported from the package root.

---

## Why not just use chardet or jschardet?

Both are active and both are good at the job they do. Measured on 1,735 samples of
real translated text (zh-hans/zh-hant/ja/ko, four length buckets):

| | chardet | jschardet | encforensics |
|---|---|---|---|
| Overall top-1 accuracy | 86.5% | 89.5% | **not competing** |
| BOM-less UTF-16 (any length) | **0%** | **0%** | detects, or refuses on pure CJK |
| Reports *why* | no | no | yes, per candidate |
| Can say "I don't know" | no | no | **yes — this is a first-class answer** |
| Repairs already-broken text | no | no | **yes** |
| Locates the damaged byte | no | no | **yes** |

`encforensics` deliberately does **not** try to beat 89.5%. Getting there needs a
statistical language model, and shipping a worse one would be dishonest. Its value is
in the questions the other two cannot answer at all.

---

## Known limits

Stated plainly, because a forensics tool that overstates itself is worse than useless:

1. **Odd-length UTF-8 byte streams mis-read as GBK are unrecoverable.** GBK pairs bytes
   two at a time; a 27-byte UTF-8 string becomes 13 characters and the last byte is
   dropped *without* leaving `U+FFFD`. Nothing can detect this — the information is
   simply gone. This is why the GB18030 recovery rate is 79.2% and not ~100%.
2. **Pure-CJK BOM-less UTF-16 is not detected.** With no ASCII in the text there is no
   NUL-byte pattern, and the bytes are provably identical in distribution to a legacy
   code page. The tool says so instead of guessing.
3. **Single-byte code pages cannot be separated from each other** when they both cover
   the bytes. The round-trip test narrows the field; it does not pick a winner.
4. **`naturalness` is not a language model.** It measures whether decoded text lands in
   real writing-system blocks and whether it uses commonly-used characters. It is good
   at "is this wreckage or text" and says nothing about meaning.
5. **Sample size matters.** Verdicts use the whole buffer unless `--sample` is given;
   short inputs produce more `ambiguous` answers, which is correct but may surprise.

---

## Relationship to iconv-lite, and licence

This is a derivative work of **`pillarjs/iconv-lite`** (MIT), forked at
`900f98249dea003c94b4f8dcd294387b556942bd` (`1.0.0-alpha.3`, 2026-10-25) with upstream
history preserved. `encforensics` adds `lib/probe/`, `bin/encprobe.js` and
`test/probe/`; the conversion code in `lib/`, `encodings/` and `backends/` is upstream
and unmodified apart from package metadata.

Changes to upstream files are limited to package metadata and package self-references:

- `package.json` — name, description, version, keywords, `files`, `bin`, `exports`
  (added `./probe`), repository URLs, test script globs.
- Test files that imported the package by name (`"iconv-lite"` → `"encforensics"`),
  which is required for Node's self-reference resolution after the rename.
- `README.md` moved to [`docs/upstream-readme-iconv-lite.md`](docs/upstream-readme-iconv-lite.md).

MIT permits this. The original copyright notice is retained verbatim in
[`LICENSE`](LICENSE), and [`NOTICE.md`](NOTICE.md) records the upstream project, the
exact base revision, and the list of modifications.

---

## Development

```console
npm install
npm test          # 601 tests: 507 upstream + 94 for the probe layer
npm run test:probe  # just the probe layer
npm run lint
```

Requires Node.js 22 or later (inherited from upstream's `engines` field).

Measured on Node 22.22.2 / Windows: `601 passing, 8 pending`, `npm run lint` clean.

### Layout

```
lib/probe/
  index.js             public API: analyze, repair, locate, decodeBest
  detect.js            analyze(): BOM → ASCII → Unicode validation → candidate round trips
  repair.js            repair(): mojibake chains, lossless round-trip check, damage report
  unicode-validate.js  UTF-8/16/32 structural validation with byte-accurate errors
  charset.js           candidate list and the "can this codec explain these bytes?" test
  blocks.js            Unicode block classification and the naturalness score
  commonness.js        how-common-is-this-text, judged by the code pages themselves
bin/encprobe.js        CLI
test/probe/            94 tests
docs/evidence.md       every number in this README, and the failed experiments
```
