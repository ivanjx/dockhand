/**
 * Vulnerability dashboard metadata for an environment: the total finding count,
 * the severity summary, and the distinct filter-dropdown values (image /
 * container / stack) across the full set. Lets the header badge and the filter
 * dropdowns stay complete without the page loading the full findings array.
 */
import { json } from '@sveltejs/kit';
import { getVulnerabilitiesMeta } from '$lib/server/vulnerabilities';
import { EMPTY_META } from '$lib/server/vulnerabilities-cache';
import { authorizeVulnAccess } from '$lib/server/vuln-access';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const { envIdNum, denied } = await authorizeVulnAccess(cookies, url);
	if (denied) return json({ error: denied.message }, { status: denied.status });
	if (!envIdNum) return json(EMPTY_META);

	const meta = await getVulnerabilitiesMeta(envIdNum);
	return json(meta);
};
