/**
 * Shared access check for the vulnerability endpoints (grid / count / export /
 * per-image export). Parses `env`, then enforces the same two guards every
 * endpoint needs: images:view RBAC, and (enterprise) environment scoping.
 *
 * Returns the parsed envIdNum plus a `denied` reason when access is refused —
 * the caller renders it with whatever error helper it already uses (json vs
 * jsonError), so response shape stays each endpoint's choice.
 */
import { authorize } from '$lib/server/authorize';
import type { Cookies } from '@sveltejs/kit';

export interface VulnAccess {
	envIdNum: number | undefined;
	/** Whether app auth is enabled (a tenant boundary exists to enforce). */
	authEnabled: boolean;
	/** Present when access is refused; { message, status } for the caller to render. */
	denied?: { message: string; status: number };
}

export async function authorizeVulnAccess(cookies: Cookies, url: URL): Promise<VulnAccess> {
	const auth = await authorize(cookies);

	// Parse env strictly: only a non-negative integer counts as a concrete env.
	// A present-but-garbage value is a client error, not "all environments".
	const envParam = url.searchParams.get('env');
	let envIdNum: number | undefined;
	if (envParam !== null) {
		const n = Number(envParam);
		if (!Number.isInteger(n) || n < 0) {
			return { envIdNum: undefined, authEnabled: auth.authEnabled, denied: { message: 'Invalid env', status: 400 } };
		}
		envIdNum = n;
	}

	if (auth.authEnabled && !(await auth.can('images', 'view', envIdNum))) {
		return { envIdNum, authEnabled: auth.authEnabled, denied: { message: 'Permission denied', status: 403 } };
	}
	if (envIdNum !== undefined && auth.isEnterprise && !(await auth.canAccessEnvironment(envIdNum))) {
		return { envIdNum, authEnabled: auth.authEnabled, denied: { message: 'Access denied to this environment', status: 403 } };
	}
	return { envIdNum, authEnabled: auth.authEnabled };
}
