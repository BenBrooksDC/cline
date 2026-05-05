// LuciBuild Round T (GT6): protected-range marker enforcement.
//
// Users can mark sections of code as untouchable by the agent using these
// inline markers (any single-line comment style works — //, #, --, /* ... */):
//
//   // LUCIBUILD: DO NOT EDIT             (single-line lock — line below is protected)
//   // LUCIBUILD-PROTECT-START            (region start)
//   ...protected lines...
//   // LUCIBUILD-PROTECT-END              (region end)
//
// Before any write_to_file / replace_in_file / apply_patch lands, we compare
// the OLD content's protected ranges against the NEW content. If a protected
// range is no longer byte-identical, we refuse the edit.
//
// The voice directive already documents this convention; GT6 enforces it.

const PROTECT_START_REGEX = /LUCIBUILD-PROTECT-START\b/
const PROTECT_END_REGEX = /LUCIBUILD-PROTECT-END\b/
const SINGLE_LINE_LOCK_REGEX = /LUCIBUILD\s*:\s*DO\s*NOT\s*EDIT\b/i

interface ProtectedRange {
	startLine: number // 1-indexed, inclusive — first line of protected content
	endLine: number // 1-indexed, inclusive — last line of protected content
	kind: "single" | "region"
}

/**
 * Scan content for protected ranges. Returns 1-indexed inclusive line ranges
 * of the protected CONTENT (the lines BETWEEN markers, not the markers
 * themselves — markers can be moved/edited freely as long as content stays
 * intact).
 */
export function findProtectedRanges(content: string): ProtectedRange[] {
	const lines = content.split("\n")
	const ranges: ProtectedRange[] = []
	let regionStart: number | null = null
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (PROTECT_START_REGEX.test(line)) {
			regionStart = i + 2 // protected content starts on the next line
			continue
		}
		if (PROTECT_END_REGEX.test(line) && regionStart != null) {
			const endLine = i // protected content ends on the line BEFORE the END marker
			if (endLine >= regionStart) {
				ranges.push({ startLine: regionStart, endLine, kind: "region" })
			}
			regionStart = null
			continue
		}
		// Single-line lock: the line immediately following the marker is protected.
		if (SINGLE_LINE_LOCK_REGEX.test(line)) {
			const next = i + 2 // next line, 1-indexed
			if (next <= lines.length) {
				ranges.push({ startLine: next, endLine: next, kind: "single" })
			}
		}
	}
	return ranges
}

/**
 * Extract the byte-identical text of a protected range from content.
 */
function extractRangeText(content: string, range: ProtectedRange): string {
	const lines = content.split("\n")
	return lines.slice(range.startLine - 1, range.endLine).join("\n")
}

export interface ProtectedRangeViolation {
	startLine: number
	endLine: number
	originalText: string
	proposedText: string | null // null if the range was deleted entirely
}

/**
 * Compare protected ranges between original and proposed content. Returns a
 * non-empty array iff any protected range was modified.
 */
export function checkProtectedRanges(originalContent: string, proposedContent: string): ProtectedRangeViolation[] {
	const originalRanges = findProtectedRanges(originalContent)
	if (originalRanges.length === 0) {
		return []
	}
	const violations: ProtectedRangeViolation[] = []
	for (const range of originalRanges) {
		const originalText = extractRangeText(originalContent, range)
		// We need to find the same protected range IN the proposed content. The
		// markers are the anchors. We search the proposed content for the same
		// marker pair (or single-line lock) and compare the content within.
		const proposedRanges = findProtectedRanges(proposedContent)
		// Match by index — the Nth range in original maps to the Nth range in proposed.
		// This is a heuristic; if the agent reorders ranges this could misalign,
		// but the common case (same number of ranges in same order) is reliable.
		const idx = originalRanges.indexOf(range)
		const matchingProposed = proposedRanges[idx]
		if (!matchingProposed) {
			violations.push({
				startLine: range.startLine,
				endLine: range.endLine,
				originalText,
				proposedText: null,
			})
			continue
		}
		const proposedText = extractRangeText(proposedContent, matchingProposed)
		if (proposedText !== originalText) {
			violations.push({
				startLine: range.startLine,
				endLine: range.endLine,
				originalText,
				proposedText,
			})
		}
	}
	return violations
}

/**
 * Format a violation list into a human-readable error the agent can act on.
 */
export function formatViolations(violations: ProtectedRangeViolation[], filePath: string): string {
	if (violations.length === 0) {
		return ""
	}
	const lines: string[] = [
		`LuciBuild refused this edit: it modifies ${violations.length} protected range${violations.length === 1 ? "" : "s"} in ${filePath}.`,
		`Protected ranges are marked with "// LUCIBUILD: DO NOT EDIT" or "// LUCIBUILD-PROTECT-START"..."// LUCIBUILD-PROTECT-END".`,
		`To proceed, either don't touch those ranges, or remove the markers from the file first.`,
		"",
		"Affected ranges:",
	]
	for (const v of violations) {
		lines.push(`  - lines ${v.startLine}-${v.endLine}`)
	}
	return lines.join("\n")
}
