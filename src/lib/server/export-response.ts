/** Shared helpers for the vulnerability export endpoints (env-wide + per-image). */
import { findingsToSarif } from '$lib/utils/sarif';
import type { Finding } from '$lib/utils/vulnerability';

/** JSON error response with the given status. */
export function jsonError(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Make a value safe for use in a download filename. */
export function slugify(name: string, fallback = 'export'): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

/**
 * Build the export download response for json | csv | sarif. The caller supplies
 * the format-specific JSON body and a CSV renderer; sarif is generated from the
 * shared findings so both endpoints emit identical SARIF.
 */
export function exportResponse(opts: {
	format: string;
	filenameBase: string;
	findings: Finding[];
	jsonBody: unknown;
	toCSV: (findings: Finding[]) => string;
}): Response {
	const { format, filenameBase, findings, jsonBody, toCSV } = opts;

	let content: string;
	let contentType: string;
	let ext: string;

	switch (format) {
		case 'csv':
			content = toCSV(findings);
			contentType = 'text/csv';
			ext = 'csv';
			break;
		case 'sarif':
			content = JSON.stringify(findingsToSarif(findings), null, 2);
			contentType = 'application/sarif+json';
			ext = 'sarif';
			break;
		case 'json':
		default:
			content = JSON.stringify(jsonBody, null, 2);
			contentType = 'application/json';
			ext = 'json';
			break;
	}

	// Defensively strip anything that could break out of the quoted filename or
	// inject a header, regardless of what the caller passed (today it's slug+date).
	const safeBase = filenameBase.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';

	return new Response(content, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${safeBase}.${ext}"`
		}
	});
}
