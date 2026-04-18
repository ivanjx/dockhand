import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { revokeApiToken } from '$lib/server/api-tokens';
import { isAuthEnabled } from '$lib/server/auth';
import { audit } from '$lib/server/audit';

/**
 * DELETE /api/auth/tokens/[id] - Revoke an API token
 */
export const DELETE: RequestHandler = async (event) => {
	const { cookies, params } = event;

	const authEnabled = await isAuthEnabled();
	if (!authEnabled) {
		return json({ error: 'Authentication is not enabled' }, { status: 400 });
	}

	const auth = await authorize(cookies);
	if (!auth.isAuthenticated || !auth.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const tokenId = parseInt(params.id);
	if (isNaN(tokenId)) {
		return json({ error: 'Invalid token ID' }, { status: 400 });
	}

	const success = await revokeApiToken(tokenId, auth.user.id, auth.isAdmin);
	if (!success) {
		return json({ error: 'Token not found or access denied' }, { status: 404 });
	}

	await audit(event, 'delete', 'api_token', {
		entityId: params.id,
		description: `API token revoked`
	});

	return json({ success: true });
};
