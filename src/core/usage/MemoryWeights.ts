import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

const WEIGHTS_PATH = path.join(os.homedir(), ".claude", "lucibuild-memory-weights.json")
const DEFAULT_WEIGHT = 1.0
const MIN_WEIGHT = 0.1
const MAX_WEIGHT = 10.0

/**
 * LuciBuild fork (T33): per-memory-file weight registry.
 *
 * - Each memory entry (filename) has a weight, default 1.0.
 * - Memory loader uses these weights to ORDER the index — heavier weights
 *   render closer to the top so they're more salient.
 * - Weights bump up when an agent-output that referenced a memory was
 *   accepted; bump down when rejected.
 * - Reading is sync via in-memory cache; writes are debounced + async.
 *
 * Storage: ~/.claude/lucibuild-memory-weights.json — JSON map of filename → number
 */

let cache: Record<string, number> | null = null
let dirty = false
let flushTimer: NodeJS.Timeout | null = null

async function load(): Promise<Record<string, number>> {
	if (cache) return cache
	try {
		const raw = await fs.readFile(WEIGHTS_PATH, "utf-8")
		cache = JSON.parse(raw) as Record<string, number>
	} catch {
		cache = {}
	}
	return cache
}

async function flush(): Promise<void> {
	if (!dirty || !cache) return
	dirty = false
	try {
		await fs.mkdir(path.dirname(WEIGHTS_PATH), { recursive: true })
		await fs.writeFile(WEIGHTS_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8")
	} catch (err) {
		Logger.warn(`MemoryWeights: failed to flush: ${(err as Error).message}`)
	}
}

function scheduleFlush(): void {
	if (flushTimer) return
	flushTimer = setTimeout(() => {
		flushTimer = null
		flush().catch(() => {
			/* ignore */
		})
	}, 1500)
}

export async function getWeight(filename: string): Promise<number> {
	const w = await load()
	return w[filename] ?? DEFAULT_WEIGHT
}

export async function getAllWeights(): Promise<Record<string, number>> {
	return await load()
}

export async function bumpWeight(filename: string, delta: number): Promise<number> {
	const w = await load()
	const current = w[filename] ?? DEFAULT_WEIGHT
	const next = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, current + delta))
	w[filename] = next
	dirty = true
	scheduleFlush()
	return next
}

/**
 * Bump multiple memory files by the same delta. Used when a successful
 * agent output cites multiple memory entries.
 */
export async function bumpWeights(filenames: string[], delta: number): Promise<void> {
	const w = await load()
	for (const f of filenames) {
		const current = w[f] ?? DEFAULT_WEIGHT
		w[f] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, current + delta))
	}
	dirty = true
	scheduleFlush()
}

/**
 * Re-order memory index lines by their weights (heavier first).
 * Input: raw MEMORY.md content (markdown bullet list of memory entries).
 * Output: same content with bullet lines sorted by weight desc, ties keep original order.
 */
export async function sortIndexByWeight(indexContent: string): Promise<string> {
	const weights = await load()
	const lines = indexContent.split("\n")
	type Bullet = { line: string; filename: string | null; weight: number; idx: number }
	const bullets: Bullet[] = []
	const nonBullets: { line: string; idx: number }[] = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const m = line.match(/^\s*[-*]\s+\[(.+?)\]\((.+?)\)/)
		if (m) {
			const filename = m[2]
			bullets.push({ line, filename, weight: weights[filename] ?? DEFAULT_WEIGHT, idx: i })
		} else {
			nonBullets.push({ line, idx: i })
		}
	}
	if (bullets.length === 0) return indexContent
	bullets.sort((a, b) => b.weight - a.weight || a.idx - b.idx)
	// Recompose: keep non-bullets at their original positions where possible (header etc.)
	// Simple strategy: emit non-bullets at top in original order, then sorted bullets
	const out: string[] = []
	for (const nb of nonBullets) out.push(nb.line)
	for (const b of bullets) out.push(b.line)
	return out.join("\n")
}
