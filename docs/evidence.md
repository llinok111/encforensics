# Evidence

Every number quoted in the README comes from a script in this directory tree. None of
it is estimated, and the experiments that **failed** are recorded too — they are the
reason the design looks the way it does.

Reproduction scripts live in [`repro/`](repro/). They need a corpus that is not
vendored here; see "Corpus" below.

Machine: Windows, Node 22.22.2, ICU 78.2, iconv-lite `1.0.0-alpha.3`.
Unless stated otherwise each cell is 40 samples for the detector work and 200 samples
for the repair work.

## Corpus

[`microsoft/vscode-loc`](https://github.com/microsoft/vscode-loc) (MIT) — the VS Code
language packs. Human translations, not synthetic text, and public.

| File | Language | Usable strings |
|---|---|---|
| `vscode-language-pack-zh-hans/translations/main.i18n.json` | Simplified Chinese | 19,051 containing CJK |
| `…-zh-hant/…` | Traditional Chinese | 2 MB |
| `…-ja/…` | Japanese | 2.6 MB |
| `…-ko/…` | Korean | 2.4 MB |
| `…-ru/…` | Russian | 0.5 MB |

```console
for L in zh-hans zh-hant ja ko ru; do
  curl -sL -o loc-$L.json \
    "https://raw.githubusercontent.com/microsoft/vscode-loc/main/i18n/vscode-language-pack-$L/translations/main.i18n.json"
done
```

Downloading these over a throttled link truncates silently — `JSON.parse` is the only
thing that catches it. Two of five files arrived short on the first attempt.

## 1. Candidate selection

| Candidate | Licence | Weekly npm downloads | Last push | Gap we would fill | Verdict |
|---|---|---|---|---|---|
| `pillarjs/iconv-lite` | MIT | 197,069,293 | 2026-10-25 | no detection of any kind | **selected** |
| `NaturalIntelligence/fast-xml-parser` | MIT | 51,547,166 | 2026-10-18 | DTD / entity expansion | **rejected** — already implemented in 5.11.2 (`entityDecoder`, `maxEntitySize`, `maxEntityCount`, `maxEntityDepth`) |
| `kewisch/ical.js` | MPL-2.0 | 561,836 | 2026-10-26 | timezone expansion | **rejected** — upstream already ships `Timezone` and `getTimeZoneByID`; the IANA table is deliberately external. MPL file-level copyleft adds delivery cost without adding value |

### Upstream's own position

- **issue #41 "how to detect encoding?"** — author `ashtuchkin`: `No, sorry.`
- **issue #113** — the author's suggested workaround is BOM sniffing plus fallback; a
  community member then built `node-autodetect-decoder-stream` to wrap `jschardet`.
- `README.md` line 117 pushes the requirement to a third-party module.
- `grep -rin "detect|guess|sniff|probe" lib/` → **zero hits** (the only match in the
  repository is the README's third-party recommendation).

### The ecosystem is not empty — that is not the argument

| Package | Version | Weekly downloads | Last push |
|---|---|---|---|
| `chardet` (`runk/node-chardet`) | 2.2.0 | 39,029,561 | 2026-10-01 |
| `jschardet` (`aadsm/jschardet`) | 4.1.0 | 813,195 | 2026-10-25 |
| `mojibake` | — | 1 | — |
| `detect-encoding` | — | 1 | — |

Correcting a widely repeated claim: **`jschardet` is not abandoned.** It is at 4.1.0 and
was pushed the day before this was written. So "the ecosystem is missing" is not a
reason to build anything. The reason is that both libraries **measurably fail on
specific, common inputs**, below.

## 2. Competitor baseline

Top-1 accuracy on 1,735 samples, only counting samples that round-trip losslessly:

| Scenario | chardet | jschardet |
|---|---|---|
| Overall | 1500/1735 = **86.5%** | **89.5%** |
| **UTF-16LE, no BOM — every length** | **0/132 = 0%** | **0/132 = 0%** |
| zh-hans GB18030 @16 characters | 26/40 = 65.0% | 37/40 = 92.5% |
| zh-hant GB18030 @16 characters | 27/40 = 67.5% | 32/40 = 80.0% |
| ko EUC-KR @16 characters | 21/40 = 52.5% | 37/40 = 92.5% |

Conclusion: on general accuracy they are effective, and `encforensics` should not
compete there. The real gap is **BOM-less UTF-16** (0% for both) and **already-broken
text** (neither attempts it).

## 3. Experiments that failed, and what they ruled out

Recorded so this ground is not re-covered.

### 3.1 Illegal-byte rate cannot separate double-byte code pages

| Bytes | Decoded as | Illegal sequences |
|---|---|---|
| zh-hans, GB18030 | gb18030 | 0.0% |
| zh-hans, GB18030 | big5 | **0.4%** |

GB18030 is a four-byte encoding covering nearly the whole byte space; Big5 accepts
almost the same lead/trail ranges. Margin: 0.4 percentage points. Unusable.

### 3.2 Block structure cannot separate double-byte code pages

The same GBK bytes read as Big5 produce `婓落翑弝芞笢蚚…`, of which **58.3% land inside
the CJK Unified Ideographs block**, for a native-block coverage of **91.5%** — against
**99.6%** for the correct decode.

A wrong decode of Chinese bytes into another double-byte code page still yields Chinese
characters. It *looks* like Chinese at every level coarser than word frequency.

### 3.3 Byte entropy cannot distinguish UTF-16 from a single-byte code page

`entropy(low bytes) − entropy(high bytes)`:

| Input | min | median |
|---|---|---|
| true UTF-16LE, zh-hans, 60–300 characters | **−0.22** | −0.22 |
| true UTF-16LE, ja | 0.31 | 2.34 |
| gb18030 bytes read as UTF-16LE | −0.63 | −0.63 |
| utf-8 bytes read as UTF-16LE | −0.27 | −0.27 |

Sign flips, ranges overlap completely. Discarded. (An earlier 1,000-character sample
with no spaces suggested a 1.9 gap; that was an artefact of the sample, not a signal.)

### 3.4 The high-byte "band" is not a signal either

Share of high bytes landing in `0x80–0xA0`:

| Input | max |
|---|---|
| true UTF-16LE zh-hans | 25.0% |
| true UTF-16LE zh-hant | 45.5% |
| true UTF-16LE ko | 0.0% |
| **zh-hant bytes read as UTF-16LE** | **66.7%** |

The false case scores higher than the true one. Discarded.

### 3.5 A "mix of scripts" penalty rewrote correct Japanese

Multiplying the quality score by script dominance looked appealing until the
false-positive test on Japanese ran: **112 of 200** correct Japanese strings were
"repaired" into hanzi mojibake, because Japanese legitimately mixes kanji, hiragana and
katakana and the penalty pushed the score *up* after a wrong re-decode. Removed.

## 4. Signals that survived

### 4.1 CJK extension blocks must not count as "writing"

Wrong decodes land in U+3400–U+4DBF constantly. Counting those as writing let mojibake
score 1.0. Excluding them (and the compatibility ideographs) is what makes the
naturalness score usable:

- `naturalness("这是一段正常的中文文本")` = 1.000
- `naturalness("\u3400\u3401\u3402\u3403")` = 0.000

### 4.2 NUL-byte pattern: the only reliable BOM-less UTF-16 signal

Share of code units whose high byte is `0x00`:

| Input | min | median | max |
|---|---|---|---|
| **gb18030 bytes** | 0.0% | 0.0% | **0.0%** |
| **big5 bytes** | 0.0% | 0.0% | **0.0%** |
| **shift_jis bytes** | 0.0% | 0.0% | **0.0%** |
| **euc-kr bytes** | 0.0% | 0.0% | **0.0%** |
| **utf-8 bytes** | 0.0% | 0.0% | **0.0%** |
| true UTF-16LE, mixed Chinese + ASCII | 30.8% | — | 70.8% |
| true UTF-16LE, pure CJK | 0.0% | 0.0% | — |

Complete separation, because no real text contains U+0000. The threshold is 15%.

The last row is the honest cost: **pure-CJK BOM-less UTF-16 carries no signal at all**
and is refused rather than guessed. The tool says so in `notes`.

### 4.3 Common-character rate: reading frequency off the code pages

Each East Asian standard splits its hanzi plane into a frequent level and a rare level.
That split is a frequency prior shipped with every code page:

- GB2312 level 1: `0xB0A1–0xD7F9` (3,755 characters, sorted by pinyin)
- Big5 frequent: `0xA440–0xC67E`
- JIS X 0208 level 1: Shift_JIS `0x889F–0x9872`
- KS X 1001 common hangul: `0xB0A1–0xC8FE`

Encoding a character back into the standard reveals which level it belongs to, so no
corpus needs to be shipped.

| Text | Common-character rate under GB18030 |
|---|---|
| real Simplified Chinese, 300 samples, mean | **100.0%** |
| the same text after a GBK misread, mean | **32.4%** |

This is what separates `鏇村鎿嶄綔` from `更多操作` — both are "just hanzi", both score
1.0 on naturalness, and only the frequency prior tells them apart.

### 4.4 Mojibake is deterministic, not statistical

| Chain | Round trip | Reversible |
|---|---|---|
| UTF-8 bytes → read as latin1 → re-encode latin1 | byte-for-byte equal | **yes** |
| UTF-8 bytes → read as gb18030 → re-encode gb18030 | fails at byte 32 (`0xa4`); string contains `U+FFFD` | lossy, but **detectable** |
| GBK bytes → read as utf-8 | produces `U+FFFD`, length 57 → 40 | not reversible, **detectable** |

One wrinkle: `U+20AC` has two GBK byte forms (`0x80` and `0xA2E3`), so a strict round
trip can reject text that is fully recoverable. The check therefore accepts ≥90%
character fidelity and reports the fidelity it achieved in `chain[].fidelity`.

## 5. Repair accuracy

Generated programmatically — hand-typed mojibake is worthless as a test, because one
wrong character changes every byte boundary. (This was learned the hard way: an early
test suite was written with hand-copied mojibake whose byte count did not even match the
original.)

| Chain | Lossless inputs | Recovered | Missed | Wrong | Inputs already lost |
|---|---|---|---|---|---|
| utf-8 → gb18030 | 48 | 38 (79.2%) | 10 | **0** | 152 |
| utf-8 → big5 (zh-hans) | 3 | 3 (100%) | 0 | **0** | 197 |
| utf-8 → big5 (zh-hant) | 2 | 2 (100%) | 0 | **0** | 198 |
| utf-8 → shift_jis | 19 | 13 (68.4%) | 6 | **0** | 181 |
| utf-8 → euc-kr | 1 | 1 (100%) | 0 | **0** | 199 |
| utf-8 → iso-8859-1 | 200 | **200 (100%)** | 0 | **0** | 0 |
| utf-8 → windows-1252 | 200 | 30 (15.0%) | 170 | **0** | 170 |

`windows-1252` looks bad until you notice that the code page has five undefined byte
values (`0x81 0x8D 0x8F 0x90 0x9D`), so 170 of 200 inputs were already damaged. Those
are correctly refused.

### False positives

| Language | Correct strings tested | Changed |
|---|---|---|
| zh-hans | 200 | **0** |
| zh-hant | 200 | **0** |
| ja | 200 | **0** |
| ko | 200 | **0** |

**0 / 800.** This is the number that decides whether the tool is safe to put in a
pipeline.

### Why the recovery rate is not ~100%

GBK consumes bytes two at a time. A UTF-8 string whose byte length is odd — for example
`正在进行区分大小写`, 27 bytes — becomes 13 GBK characters and **the 27th byte is dropped
without leaving `U+FFFD`**. The information is gone and no detector can see it. Of the
10 "missed" GB18030 samples, all 10 are of this kind.

Verified separately: 24-byte inputs (`更多操作关闭对话`) recover, 27-byte inputs
(`正在进行区分大小写`) do not.

## 6. Test suite

| | Count |
|---|---|
| Upstream tests (unchanged, baseline confirmed before any modification) | **507 passing, 8 pending, 0 failing** |
| Probe layer tests (new) | **120** |
| Combined `npm test` | **627 passing, 8 pending, 0 failing** |

Upstream baseline was captured *before* touching anything, by running `npm test` on the
fresh clone: `507 passing (23s), 8 pending`. The same figure after the change confirms
zero regressions.

Coverage of the new code (`c8`, statements / branches / functions):

| File | Stmts | Branch | Funcs |
|---|---|---|---|
| `lib/probe/blocks.js` | 100% | 100% | 100% |
| `lib/probe/charset.js` | 95.95% | 90% | 100% |
| `lib/probe/commonness.js` | 98.11% | 91.66% | 100% |
| `lib/probe/detect.js` | 90.18% | 88.57% | 100% |
| `lib/probe/index.js` | 100% | 68.75% | 100% |
| `lib/probe/repair.js` | 90.9% | 77.38% | 100% |
| `bin/encprobe.js` | 92.22% | 82.75% | 100% |

## 7. Changes to upstream files

The full list, so the diff can be audited:

1. `package.json` — `name`, `description`, `version`, `keywords`, `files`, `bin`,
   `exports` (added `./probe`), `homepage`/`bugs`/`repository`, `test` and `test:probe`
   script globs.
2. Test files importing the package by name — `"iconv-lite"` → `"encforensics"`
   (`test/esm.test.js`, `test/helpers/utils.js`, `test/types/*.ts`,
   `test/webpack/*`). Node resolves a package's self-imports through its own `name`
   field, so the rename breaks them otherwise. This was discovered by `npm test`
   failing with `ERR_MODULE_NOT_FOUND` after the rename.
3. `README.md` → `docs/upstream-readme-iconv-lite.md`.
4. `test/wpt/UPSTREAM` → `test/wpt/UPSTREAM.txt`, plus the three references to it
   (`test/wpt/README.md`, `test/wpt/update.js`, `.github/workflows/wpt-update.yml`).

### 7.1 A Windows defect inherited from upstream

Upstream ships `test/wpt/UPSTREAM` (a two-line file naming the WPT revision) alongside
the directory `test/wpt/upstream/`. The names differ only in case. On a case-insensitive
filesystem they are the same path, so:

- `git clone` silently leaves `test/wpt/upstream/` **empty** (20 files missing);
  `git status` then reports 20 deletions.
- Extracting the delivery ZIP fails outright:
  `FileExistsError: [WinError 183] ... 'test/wpt/upstream'`.

Neither symptom points at the cause — the clone looks fine until you run `git status`.
The fix is a rename; it changes no test behaviour, and `npm run test:wpt` still resolves
the revision file. This is recorded because it will recur for anyone who clones this
repository (or upstream) on Windows.

No file under `lib/`, `encodings/` or `backends/` (excluding the new `lib/probe/`) was
modified.
