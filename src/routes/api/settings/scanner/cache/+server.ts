import { json, type RequestHandler } from '@sveltejs/kit';
import { cleanupScannerCache } from '$lib/server/scanner';
import { authorize } from '$lib/server/authorize';
import { getEnvironments } from '$lib/server/db';

export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const envs = await getEnvironments();

		// Clean local cache (volumes + bind mount dirs)
		const result = await cleanupScannerCache();

		// Clean remote environment volumes
		const skippedEnvs: string[] = [];
		for (const env of envs) {
			try {
				const envResult = await cleanupScannerCache(env.id);
				result.volumes.push(...envResult.volumes);
			} catch {
				skippedEnvs.push(env.name);
			}
		}

		return json({
			success: true,
			removedVolumes: result.volumes,
			removedDirs: result.dirs,
			skippedEnvironments: skippedEnvs
		});
	} catch (error) {
		console.error('Failed to clear scanner cache:', error);
		return json({ error: 'Failed to clear scanner cache' }, { status: 500 });
	}
};
