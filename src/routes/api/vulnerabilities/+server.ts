import { json } from '@sveltejs/kit';
import { getVulnerabilitiesPage, parseVulnerabilitiesQuery } from '$lib/server/vulnerabilities';
import { authorizeVulnAccess } from '$lib/server/vuln-access';
import type { RequestHandler } from './$types';

/**
 * A page of aggregated vulnerability findings for an environment, filtered and
 * sorted server-side. Query: limit, offset, q, severity, image, container,
 * stack, sort, dir. Returns { findings, total } where `total` is the filtered
 * count (for the "X-Y of N" counter and infinite scroll).
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const { envIdNum, denied } = await authorizeVulnAccess(cookies, url);
	if (denied) return json({ error: denied.message }, { status: denied.status });
	if (!envIdNum) return json({ findings: [], total: 0 });

	const result = await getVulnerabilitiesPage(envIdNum, parseVulnerabilitiesQuery(url));
	return json(result);
};
