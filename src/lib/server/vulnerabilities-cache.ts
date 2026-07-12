/**
 * Short-TTL per-environment cache for the aggregated vulnerability findings.
 *
 * Lives in its own module (importing only client-safe types) so that db.ts can
 * invalidate it from inside saveVulnerabilityScan WITHOUT a circular import
 * (vulnerabilities.ts imports db.ts). That way every writer of a scan row
 * automatically refreshes the dashboard — no caller can forget.
 */
import { EMPTY_SUMMARY } from '../utils/vulnerability';
import type { Finding, VulnerabilitySummary } from '$lib/utils/vulnerability';

export const CACHE_TTL_MS = 30_000;
/** Per-env cap on memoized filter/sort views (bounds server memory). */
export const MAX_VIEWS = 8;
/** Cap on cached environments — bounds total memory when many envs are viewed.
 *  Least-recently-inserted env entry is evicted past this. */
export const MAX_ENVS = 16;

export interface AggregatedVulnerabilities {
	findings: Finding[];
	summary: VulnerabilitySummary;
}

export interface VulnerabilitiesMeta {
	total: number;
	summary: VulnerabilitySummary;
	options: { images: string[]; containers: string[]; stacks: string[] };
}

/** Empty meta for the no-environment case — shared so the shape isn't re-typed. */
export const EMPTY_META: VulnerabilitiesMeta = {
	total: 0,
	summary: EMPTY_SUMMARY,
	options: { images: [], containers: [], stacks: [] }
};

export interface CacheEntry {
	at: number;
	data: AggregatedVulnerabilities;
	/** Memoized filtered+sorted arrays within this cache window, keyed by query. */
	views: Map<string, Finding[]>;
	/** Memoized meta (distinct filter options) — computed once per window. */
	meta?: VulnerabilitiesMeta;
}

// Keyed by envId. The null-environment ("local"/default) is keyed as 0 since the
// dashboard aggregation only ever runs for a concrete numeric env id.
export const aggregateCache = new Map<number, CacheEntry>();
/** Collapse concurrent cold-start requests into one aggregation. */
export const inflight = new Map<number, Promise<AggregatedVulnerabilities>>();

/**
 * Drop cached findings. Pass an env id to clear just that environment; pass
 * nothing to clear all (e.g. a broad change where the affected env is unknown).
 */
/** Cache occupancy — for the metrics endpoint. `envs` = cached environments,
 *  `views` = total memoized filter/sort views, `inflight` = cold aggregations running. */
export function getVulnerabilitiesCacheStats(): { envs: number; views: number; inflight: number } {
	let views = 0;
	for (const entry of aggregateCache.values()) views += entry.views.size;
	return { envs: aggregateCache.size, views, inflight: inflight.size };
}

export function invalidateVulnerabilitiesCache(envIdNum?: number | null): void {
	if (envIdNum === undefined || envIdNum === null) {
		aggregateCache.clear();
		// Also drop in-flight aggregations: one racing a scan-save would otherwise
		// resolve to pre-scan data and get installed with a fresh TTL, masking the
		// new scan for a full window. Dropping it forces the next reader to re-run.
		inflight.clear();
	} else {
		aggregateCache.delete(envIdNum);
		inflight.delete(envIdNum);
	}
}
