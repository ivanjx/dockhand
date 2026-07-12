/**
 * Shared types + helpers used by every notification provider.
 *
 * Imported by the router (./index.ts) and by every per-provider file
 * (discord.ts, slack.ts, …). Keeps the providers free of cross-imports —
 * each provider only depends on this module.
 */

export interface NotificationPayload {
	title: string;
	message: string;
	type?: 'info' | 'success' | 'warning' | 'error';
	environmentId?: number;
	environmentName?: string;
}

export interface NotificationResult {
	success: boolean;
	error?: string;
}

/**
 * Timeout for an outbound notification request, overridable via
 * NOTIFICATION_TIMEOUT_MS. Falls back to 10s if unset or invalid (a bad value
 * must not silently disable the timeout).
 */
const NOTIFICATION_TIMEOUT_MS = (() => {
	const parsed = Number(process.env.NOTIFICATION_TIMEOUT_MS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
})();

/**
 * fetch() with a per-request timeout. Notification destinations are
 * user-configured (and a potential SSRF target); without a timeout a hung
 * endpoint pins the request indefinitely and blocks the rest of the dispatch.
 */
export function notificationFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
	return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(NOTIFICATION_TIMEOUT_MS) });
}

/** Drain a response body to release the underlying socket/TLS connection. */
export async function drainResponse(response: Response): Promise<void> {
	if (!response.bodyUsed) {
		try { await response.arrayBuffer(); } catch {}
	}
}

/** Append `[env name]` to a title when present. Used by every provider. */
export function titleWithEnv(payload: NotificationPayload): string {
	return payload.environmentName ? `${payload.title} [${payload.environmentName}]` : payload.title;
}
