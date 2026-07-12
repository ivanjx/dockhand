/**
 * Vulnerability block decision with a fresh current-image scan.
 *
 * Kept separate from update-utils.ts so that the pure decision logic
 * (shouldBlockUpdate, combineScanSummaries) stays free of DB/scanner runtime
 * deps and remains unit-testable. This module is allowed to touch the DB and
 * the scanner.
 */

import type { VulnerabilityCriteria } from '../../db';
import { type VulnerabilitySeverity, scanImage } from '../../scanner';
import { getCombinedScanForImage, saveVulnerabilityScan } from '../../db';
import { shouldBlockUpdate, combineScanSummaries } from './update-utils';

/**
 * Resolve the block decision for a new image, handling the 'more_than_current'
 * criteria robustly.
 *
 * For 'more_than_current' the new image's vuln count is compared against the
 * CURRENT image's count. The current count comes from the scan cache, which can
 * be (a) stale — vuln DBs grow, so an old cached scan understates the current
 * image and falsely makes the new image look worse (#1022), or (b) missing — no
 * scan exists, so the comparison is skipped and a genuinely more-vulnerable
 * update slips through. Both are fixed here: when the cached comparison would
 * block (or there is no cache), the current image is RE-SCANNED fresh and the
 * comparison is redone against up-to-date numbers.
 *
 * For all other criteria this is a thin wrapper around shouldBlockUpdate.
 *
 * @param newSummary      combined scan summary of the new image
 * @param currentImageId  sha256 image id of the currently-running image
 * @param envId           environment id (for scanner settings + cache scoping)
 * @param criteria        the configured vulnerability criteria
 * @param log             log sink for human-readable progress
 */
export async function resolveBlockDecision(
	newSummary: VulnerabilitySeverity,
	currentImageId: string,
	envId: number | null | undefined,
	criteria: VulnerabilityCriteria,
	log: (msg: string) => void
): Promise<{ blocked: boolean; reason: string }> {
	if (criteria !== 'more_than_current') {
		return shouldBlockUpdate(criteria, newSummary);
	}

	const total = (s: VulnerabilitySeverity) => s.critical + s.high + s.medium + s.low;
	const newTotal = total(newSummary);

	// 1. Start from the cached scan of the current image, if any.
	let currentSummary: VulnerabilitySeverity | undefined;
	let currentFromCache = false;
	try {
		const cached = await getCombinedScanForImage(currentImageId, envId ?? null);
		if (cached) {
			currentSummary = cached;
			currentFromCache = true;
			log(`more_than_current: current image cached scan = ${total(cached)} vulns (${cached.critical}C/${cached.high}H/${cached.medium}M/${cached.low}L)`);
		} else {
			log(`more_than_current: no cached scan for current image`);
		}
	} catch (err: any) {
		log(`more_than_current: cache lookup failed (${err.message})`);
	}

	const wouldBlock = currentSummary !== undefined && newTotal > total(currentSummary);

	// 2. Re-scan the current image when the cached comparison would block, or
	//    when there is no cached scan at all. A fresh scan of the SAME current
	//    image is the only trustworthy basis for blocking (#1022).
	if (!currentFromCache || wouldBlock) {
		log(
			currentFromCache
				? `more_than_current: cached comparison would block (new ${newTotal} > current ${total(currentSummary!)}) — re-scanning current image to confirm`
				: `more_than_current: scanning current image (${currentImageId.substring(0, 19)}) for comparison`
		);
		try {
			const results = await scanImage(currentImageId, envId ?? undefined, (p) => {
				if (p.message) log(`  [${p.scanner || 'scan'}] ${p.message}`);
			});
			if (results.length > 0) {
				const fresh = combineScanSummaries(results.map((r) => ({ summary: r.summary })));
				log(`more_than_current: current image fresh scan = ${total(fresh)} vulns (${fresh.critical}C/${fresh.high}H/${fresh.medium}M/${fresh.low}L)`);
				currentSummary = fresh;
				// Persist so the next cycle starts from a current value.
				for (const r of results) {
					try {
						await saveVulnerabilityScan({
							environmentId: envId ?? null,
							imageId: currentImageId,
							imageName: r.imageName,
							scanner: r.scanner,
							scannedAt: r.scannedAt,
							scanDuration: r.scanDuration,
							criticalCount: r.summary.critical,
							highCount: r.summary.high,
							mediumCount: r.summary.medium,
							lowCount: r.summary.low,
							negligibleCount: r.summary.negligible,
							unknownCount: r.summary.unknown,
							vulnerabilities: r.vulnerabilities,
							error: r.error ?? null
						});
					} catch { /* ignore save errors */ }
				}
			} else {
				log(`more_than_current: current image scan returned no results`);
			}
		} catch (err: any) {
			log(`more_than_current: current image scan failed (${err.message})`);
		}
	}

	const decision = shouldBlockUpdate('more_than_current', newSummary, currentSummary);
	const curTotal = currentSummary ? total(currentSummary) : 'unknown';
	log(
		decision.blocked
			? `more_than_current: BLOCKED — new ${newTotal} > current ${curTotal}`
			: `more_than_current: allowed — new ${newTotal} <= current ${curTotal}${currentSummary === undefined ? ' (current count unavailable; not blocking)' : ''}`
	);
	return decision;
}
