// Type declarations for the encoding forensics layer.
//
// The conversion API is unchanged; these types describe only what lib/probe adds.

export type EncodingFamily = "unicode" | "dbcs" | "sbcs"

export type Verdict =
  | "certain"
  | "probable"
  | "ambiguous"
  | "binary"
  | "unknown"
  | "empty"
  | "text-only"

export interface BomInfo {
  encoding: string
  label: string
  /** Byte length of the BOM: 2, 3 or 4. */
  length: number
  bytes: number[]
}

export interface Candidate {
  encoding: string
  label: string
  family: EncodingFamily
  /** Share of characters that belong to a writing system, 0..1. */
  naturalness: number
  /** Share of script characters belonging to the dominant script, 0..1. */
  dominance: number
  dominant: string | null
  /** True when decoding and re-encoding reproduces the input bytes exactly. */
  losslessRoundTrip: boolean
}

export interface Utf8Validation {
  ok: boolean
  asciiBytes: number
  sequences: number
  multiByte: number
  errorCount: number
  errors: Array<{
    /** Byte offset of the offending byte. */
    at: number
    /** Byte offset where the broken sequence started. */
    sequenceStart: number
    kind: string
    detail: string
  }>
}

export interface UnitAnalysis {
  units: number
  aligned: boolean
  /** Share of code units landing in writing-system blocks, 0..1. */
  plausibleRate: number
  surrogateErrors: number
  surrogateRate: number
  controlRate: number
  /** Share of units whose high byte is 0x00. The decisive BOM-less UTF-16 signal. */
  highZeroRatio: number
  kinds: Record<string, number>
}

export interface AnalysisReport {
  kind: "bytes" | "text"
  bytes: number
  verdict: Verdict
  encoding: string | null
  encodingLabel?: string
  confidence: number
  bom: BomInfo | null
  /** Human-readable reasons for the verdict. */
  why: string[]
  candidates: Candidate[]
  /** Present when verdict is "ambiguous": the highest-naturalness candidate among equals. */
  hint?: { encoding: string; label: string; naturalness: number }
  unicode: {
    utf8: Utf8Validation
    utf16le: UnitAnalysis
    utf16be: UnitAnalysis
    utf32le: UnitAnalysis
    utf32be: UnitAnalysis
  } | null
  preview: string | null
  naturalness: { score: number; total: number; writing: number; debris: number } | null
  notes: string[]
}

export interface RepairChainStep {
  /** The codec the text was wrongly read as, e.g. "iso-8859-1". */
  as: string
  /** The codec its bytes were then read as, always "utf-8" in practice. */
  then: string
  gain: number
  /** Share of characters that survived re-encoding unchanged, 0..1. */
  fidelity: number
}

export interface RepairResult {
  changed: boolean
  text: string
  input: "bytes" | "text"
  reversible: boolean
  /** Bytes known to be lost, with positions in the output string. */
  damage: Array<{ at: number; kind: string; detail: string }>
  chain: RepairChainStep[]
  why: string[]
  quality?: { before: number; after: number }
  /** Set when a byte stream was too ambiguous to decode without a user-supplied encoding. */
  needsEncoding?: boolean
  encoding?: string
  report?: AnalysisReport
}

export interface LocateResult {
  ok: boolean
  /** Byte offset of the first byte the encoding cannot explain, or -1. */
  at: number
  encoding: string
  errors: Array<{ at: number; sequenceStart?: number; kind: string; detail: string }>
  errorCount?: number
  context?: { bytes: string[]; offsetInContext: number }
}

export function analyze(input: Uint8Array | string, options?: { maxCandidates?: number }): AnalysisReport
export function repair(input: Uint8Array | string, options?: { maxDepth?: number }): RepairResult
export function locate(input: Uint8Array | string, encoding?: string): LocateResult
export function decodeBest(input: Uint8Array, options?: { maxCandidates?: number }): { report: AnalysisReport; text: string }
export function looksLikeMojibake(text: string): boolean

export function validateUtf8(buf: Uint8Array): Utf8Validation
export function analyzeUtf16(buf: Uint8Array, littleEndian: boolean): UnitAnalysis
export function analyzeUtf32(buf: Uint8Array, littleEndian: boolean): UnitAnalysis
export function naturalness(text: string): {
  score: number
  total: number
  writing: number
  debris: number
  neutral: number
  kinds: Record<string, number>
  dominant: string | null
  dominance: number
}
export function classify(codePoint: number): string
export function canEncode(encoding: string): boolean
export function roundTrip(buf: Uint8Array, encoding: string): { text: string; lossless: boolean; byteLength: number } | null
