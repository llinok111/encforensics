#!/usr/bin/env node
// encprobe — command line front end for the probe layer.
//
// Exit codes are part of the interface:
//   0  a single encoding was determined (certain / probable / ascii)
//   1  several encodings fit and byte-level evidence cannot separate them
//   2  no usable answer (binary, unknown, empty)
//   3  usage error

import fs from "node:fs"
import process from "node:process"
import { analyze, repair, locate } from "../lib/probe/index.js"

const USAGE = `encprobe — determine, explain and repair text encodings

Usage:
  encprobe <file> [options]
  encprobe --stdin [options]
  cat file | encprobe --stdin [options]

Options:
  --json            machine-readable report on stdout
  --repair          attempt to undo mojibake; print the repaired text
  --write <path>    write the repaired text to <path> instead of stdout
  --locate          report the first byte a given encoding cannot explain
  --encoding <enc>  encoding to use with --locate (default: utf-8)
  --sample <n>      bytes to read from the front of the file (default: all, max 1048576)
  --quiet           only print the verdict line
  --help            show this message

Exit codes: 0 determined, 1 ambiguous, 2 no answer, 3 usage error.`

function parseArgs (argv) {
  const out = { positional: [], json: false, repair: false, locate: false, stdin: false, quiet: false, sample: 1048576, encoding: "utf-8", write: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") out.json = true
    else if (a === "--repair") out.repair = true
    else if (a === "--locate") out.locate = true
    else if (a === "--stdin") out.stdin = true
    else if (a === "--quiet") out.quiet = true
    else if (a === "--help" || a === "-h") out.help = true
    else if (a === "--write") out.write = argv[++i]
    else if (a === "--encoding") out.encoding = argv[++i]
    else if (a === "--sample") { out.sample = Number(argv[++i]); if (!Number.isFinite(out.sample) || out.sample <= 0) out.sample = 1048576 }
    else if (a.startsWith("--")) { out.error = "unknown option: " + a }
    else out.positional.push(a)
  }
  return out
}

function readInput (args) {
  if (args.stdin || (!args.positional.length && !process.stdin.isTTY)) {
    const chunks = []
    let total = 0
    let buf
    const fd = 0
    while (total < args.sample) {
      const want = Math.min(65536, args.sample - total)
      buf = Buffer.alloc(want)
      let n
      try {
        n = fs.readSync(fd, buf, 0, want, null)
      } catch (e) {
        if (e.code === "EAGAIN") continue
        if (e.code === "EOF") break
        throw e
      }
      if (n === 0) break
      chunks.push(buf.subarray(0, n))
      total += n
    }
    return { buffer: Buffer.concat(chunks), name: "<stdin>" }
  }
  const file = args.positional[0]
  const st = fs.statSync(file)
  const size = Math.min(Number(st.size), args.sample)
  const fd = fs.openSync(file, "r")
  const buf = Buffer.alloc(size)
  fs.readSync(fd, buf, 0, size, 0)
  fs.closeSync(fd)
  return { buffer: buf, name: file, truncated: Number(st.size) > size, size: Number(st.size) }
}

function verdictExitCode (report) {
  if (report.verdict === "certain" || report.verdict === "probable" || report.verdict === "ascii") return 0
  if (report.verdict === "ambiguous") return 1
  return 2
}

function humanReport (report, source, args) {
  const lines = []
  lines.push("file      : " + source.name + (source.truncated ? "  (read first " + args.sample + " of " + source.size + " bytes)" : ""))
  lines.push("bytes     : " + report.bytes)
  lines.push("verdict   : " + report.verdict)
  if (report.encoding) lines.push("encoding  : " + (report.encodingLabel || report.encoding))
  if (report.confidence) lines.push("confidence: " + report.confidence)
  if (report.bom) lines.push("bom       : " + report.bom.label + " (" + report.bom.length + " bytes)")
  if (report.why.length) {
    lines.push("why       :")
    for (const w of report.why) lines.push("  - " + w)
  }
  if (report.candidates.length) {
    lines.push("candidates (all reproduce the input byte-for-byte):")
    for (const c of report.candidates) {
      lines.push("  - " + c.label + "  naturalness=" + c.naturalness + " dominance=" + c.dominance + " dominant=" + c.dominant)
    }
  }
  if (report.notes.length) {
    lines.push("notes     :")
    for (const n of report.notes) lines.push("  - " + n)
  }
  if (report.preview) lines.push("preview   : " + JSON.stringify(report.preview.slice(0, 100)))
  return lines.join("\n")
}

function main () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(USAGE); return 0 }
  if (args.error) { console.error(args.error + "\n\n" + USAGE); return 3 }
  if (!args.stdin && !args.positional.length && process.stdin.isTTY) { console.error(USAGE); return 3 }

  let input
  try {
    input = readInput(args)
  } catch (e) {
    console.error("cannot read input: " + e.message)
    return 3
  }
  const buf = input.buffer
  if (!buf.length) { console.error("input is empty"); return 2 }

  if (args.locate) {
    const r = locate(buf, args.encoding)
    if (args.json) { console.log(JSON.stringify(r, null, 2)) } else if (r.ok) {
      console.log("ok        : every byte is valid " + args.encoding)
    } else {
      console.log("encoding  : " + r.encoding)
      console.log("first bad : byte " + r.at)
      for (const e of r.errors.slice(0, 8)) console.log("  - byte " + e.at + ": " + e.kind + " (" + e.detail + ")")
      if (r.context) console.log("context   : " + r.context.bytes.join(" ") + "   (bad byte is #" + r.context.offsetInContext + ")")
    }
    return r.ok ? 0 : 2
  }

  if (args.repair) {
    const rep = repair(buf)
    if (args.json) {
      console.log(JSON.stringify(rep, null, 2))
      return rep.changed ? 0 : 1
    }
    if (args.write) {
      fs.writeFileSync(args.write, rep.text, "utf8")
      console.log((rep.changed ? "repaired" : "unchanged") + " (" + rep.why.join("; ") + ") -> " + args.write)
      return rep.changed ? 0 : 1
    }
    if (rep.changed) {
      for (const w of rep.why) console.error("# " + w)
      process.stdout.write(rep.text)
      if (!rep.text.endsWith("\n")) process.stdout.write("\n")
    } else {
      for (const w of rep.why) console.error("# " + w)
      process.stdout.write(buf.toString("utf8"))
      if (!buf.toString("utf8").endsWith("\n")) process.stdout.write("\n")
    }
    return rep.changed ? 0 : 1
  }

  const report = analyze(buf, { maxCandidates: 8 })
  if (args.json) {
    console.log(JSON.stringify({ source: input.name, ...report }, null, 2))
  } else if (args.quiet) {
    console.log(report.verdict + (report.encoding ? " " + report.encoding : ""))
  } else {
    console.log(humanReport(report, input, args))
  }
  return verdictExitCode(report)
}

process.exitCode = main()
