import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getContainerStartSchedules } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

/**
 * @openapi
 * summary: Get enabled scheduled-start settings keyed by container name, limited to accessible environments
 * query: env:integer Environment to read settings for (from GET /api/environments)
 * resp-200: {}
 * resp-403: Permission denied (schedules:view), or no access to the environment
 * resp-500: Failed to get container start schedules
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	const permDenied = await auth.requirePermission('schedules', 'view');
	if (permDenied) return permDenied;

	try {
		const envIdParam = url.searchParams.get('env');
		const envId = envIdParam ? parseInt(envIdParam) : undefined;

		const envDenied = await auth.requireEnvAccess(envId);
		if (envDenied) return envDenied;

		const settings = await getContainerStartSchedules(envId);
		const accessible = envId === undefined ? await auth.getAccessibleEnvironmentIds() : null;
		const visible = accessible === null
			? settings
			: settings.filter(s => s.environmentId === null || accessible.includes(s.environmentId));
		const settingsMap: Record<string, {
			enabled: boolean;
			scheduleType: string;
			cronExpression: string | null;
		}> = {};

		for (const setting of visible) {
			if (setting.enabled) {
				settingsMap[setting.containerName] = {
					enabled: setting.enabled,
					scheduleType: setting.scheduleType,
					cronExpression: setting.cronExpression
				};
			}
		}

		return json(settingsMap);
	} catch (error) {
		console.error('Failed to get container start schedules:', error);
		return json({ error: 'Failed to get container start schedules' }, { status: 500 });
	}
};
