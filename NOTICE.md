# NOTICE

`encforensics` is a derivative work. This file records what came from where, and
exactly what was changed. The licence text in [`LICENSE`](LICENSE) is the upstream
MIT licence, unmodified.

## Upstream

| | |
|---|---|
| Project | **iconv-lite** — *Pure JS character encoding conversion* |
| Repository | https://github.com/pillarjs/iconv-lite |
| Copyright | Copyright (c) 2011 Alexander Shtuchkin |
| Licence | MIT |
| Base revision | `900f98249dea003c94b4f8dcd294387b556942bd` |
| Base version | `1.0.0-alpha.3`, released 2026-10-25 |
| Fork method | full `git clone` with history preserved, not a source tarball |

Upstream itself is MIT-licensed and permits modification and redistribution provided
the copyright notice and permission notice are retained. `LICENSE` retains them
verbatim.

## Third-party data used for verification (not distributed here)

| | |
|---|---|
| Project | **vscode-loc** — VS Code language packs |
| Repository | https://github.com/microsoft/vscode-loc |
| Copyright | Copyright (c) Microsoft Corporation |
| Licence | MIT |
| Use | test corpus only; downloaded by the scripts in `docs/repro/`, never vendored |

No third-party code is bundled in this repository.

## What this fork adds

Copyright (c) 2026 encforensics contributors. The following are new files, not present
upstream:

```
lib/probe/index.js            public API: analyze, repair, locate, decodeBest
lib/probe/detect.js           analyze(): BOM → ASCII → Unicode validation → candidate round trips
lib/probe/repair.js           repair(): mojibake chains, lossless round-trip check, damage report
lib/probe/charset.js          candidate list and the round-trip "can this codec explain these bytes?" test
lib/probe/blocks.js           Unicode block classification and the naturalness score
lib/probe/commonness.js       common-character rate derived from the code pages themselves
lib/probe/unicode-validate.js UTF-8/16/32 structural validation with byte-accurate errors
lib/probe/index.d.ts          TypeScript declarations for the probe API
bin/encprobe.js               CLI
test/probe/*.test.js          120 tests
docs/evidence.md              measurements and the experiments that failed
docs/repro/                   reproduction scripts
```

## What this fork changes upstream

Complete list. Auditable with `git diff <base-revision> HEAD`.

1. **`package.json`** — `name` (`iconv-lite` → `encforensics`), `description`,
   `version`, `keywords`, `files` (added `bin/`), `bin` (new `encprobe` entry),
   `exports` (added the `./probe` subpath), `homepage` / `bugs` / `repository`
   (repointed to the fork), `test` and `test:probe` script globs (so mocha also
   collects `test/probe/*.test.js`), and the `test:webpack` / `test:ci` tarball names
   (the packed artefact is renamed by the new package name).
2. **Package self-references in tests** — `"iconv-lite"` → `"encforensics"` in
   `test/esm.test.js`, `test/helpers/utils.js`, `test/types/iconv.ts`,
   `test/types/import.ts`, `test/webpack/basic.test.js`, `test/webpack/stream.test.js`,
   `test/webpack/karma.conf.cjs` and `test/webpack/package.json`.
   Node resolves a package's own imports through its `name` field, so renaming the
   package breaks these unless they are updated. Discovered by `npm test` failing with
   `ERR_MODULE_NOT_FOUND` immediately after the rename.
3. **`README.md`** — moved to `docs/upstream-readme-iconv-lite.md`; a new README
   documents this fork.

No file under `lib/` (other than the new `lib/probe/`), `encodings/` or `backends/`
was modified. The conversion tables, codecs, streaming API, browser backend and the
public `iconv-lite` API are exactly upstream's.

## Trademark

"iconv-lite" and the upstream project name are used here only to describe the
derivation, as the MIT licence and normal attribution practice allow. This fork is not
affiliated with, endorsed by, or maintained by the upstream authors.
