import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getContainerStartSchedule,
	upsertContainerStartSchedule,
	deleteContainerStartSchedule
} from '$lib/server/db';
import { registerSchedule, unregisterSchedule } from '$lib/server/scheduler';
import { authorize } from '$lib/server/authorize';

/**
 * @openapi
 * summary: Get a container's scheduled-start settings, or disabled defaults
 * path: containerName:string! Container name (URL-encoded)
 * query: env:integer Environment the container belongs to (from GET /api/environments)
 * resp-200: {enabled:boolean!, scheduleType:string!, cronExpression:string}
 * resp-403: Permission denied (schedules:view), or no access to the environment
 * resp-500: Failed to get container start schedule
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	const permDenied = await auth.requirePermission('schedules', 'view');
	if (permDenied) return permDenied;

	try {
		const containerName = decodeURIComponent(params.containerName);
		const envIdParam = url.searchParams.get('env');
		const envId = envIdParam ? parseInt(envIdParam) : undefined;

		const envDenied = await auth.requireEnvAccess(envId);
		if (envDenied) return envDenied;

		const setting = await getContainerStartSchedule(containerName, envId);

		if (!setting) {
			return json({
				enabled: false,
				scheduleType: 'daily',
				cronExpression: '0 3 * * *'
			});
		}

		return json({
			...setting,
			scheduleType: setting.scheduleType,
			cronExpression: setting.cronExpression
		});
	} catch (error) {
		console.error('Failed to get container start schedule:', error);
		return json({ error: 'Failed to get container start schedule' }, { status: 500 });
	}
};

/**
 * @openapi
 * summary: Save a container's scheduled-start settings; enabled=false deletes the schedule
 * path: containerName:string! Container name (URL-encoded)
 * query: env:integer Environment the container belongs to (from GET /api/environments)
 * body: {enabled:boolean, cronExpression:string, cron_expression:string}
 * resp-200: {success:boolean, deleted:boolean, id:integer, enabled:boolean, scheduleType:string, cronExpression:string}
 * resp-403: Permission denied (schedules:edit), or no access to the environment
 * resp-500: Failed to save container start schedule
 */
export const POST: RequestHandler = async ({ params, url, request, cookies }) => {
	const auth = await authorize(cookies);
	const permDenied = await auth.requirePermission('schedules', 'edit');
	if (permDenied) return permDenied;

	try {
		const containerName = decodeURIComponent(params.containerName);
		const envIdParam = url.searchParams.get('env');
		const envId = envIdParam ? parseInt(envIdParam) : undefined;

		const envDenied = await auth.requireEnvAccess(envId);
		if (envDenied) return envDenied;

		const body = await request.json();
		const enabled = body.enabled;
		const cronExpression = body.cronExpression ?? body.cron_expression;

		if (enabled === false) {
			const existing = await getContainerStartSchedule(containerName, envId);
			await deleteContainerStartSchedule(containerName, envId);
			if (existing) {
				unregisterSchedule(existing.id, 'container_start');
			}
			return json({ success: true, deleted: true });
		}

		let scheduleType: 'daily' | 'weekly' | 'custom' = 'custom';
		if (cronExpression) {
			const parts = cronExpression.split(' ');
			if (parts.length >= 5) {
				const [, , day, month, dow] = parts;
				if (dow !== '*' && day === '*' && month === '*') {
					scheduleType = 'weekly';
				} else if (day === '*' && month === '*' && dow === '*') {
					scheduleType = 'daily';
				}
			}
		}

		const setting = await upsertContainerStartSchedule(
			containerName,
			{
				enabled: Boolean(enabled),
				scheduleType,
				cronExpression: cronExpression || null
			},
			envId
		);

		if (setting.enabled && setting.cronExpression) {
			await registerSchedule(setting.id, 'container_start', setting.environmentId);
		} else {
			unregisterSchedule(setting.id, 'container_start');
		}

		return json({
			...setting,
			scheduleType: setting.scheduleType,
			cronExpression: setting.cronExpression
		});
	} catch (error) {
		console.error('Failed to save container start schedule:', error);
		return json({ error: 'Failed to save container start schedule' }, { status: 500 });
	}
};

/**
 * @openapi
 * summary: Delete a container's scheduled-start settings and unregister its cron job
 * path: containerName:string! Container name (URL-encoded)
 * query: env:integer Environment the container belongs to (from GET /api/environments)
 * resp-200: {success:boolean!}
 * resp-403: Permission denied (schedules:edit), or no access to the environment
 * resp-500: Failed to delete container start schedule
 */
export const DELETE: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	const permDenied = await auth.requirePermission('schedules', 'edit');
	if (permDenied) return permDenied;

	try {
		const containerName = decodeURIComponent(params.containerName);
		const envIdParam = url.searchParams.get('env');
		const envId = envIdParam ? parseInt(envIdParam) : undefined;

		const envDenied = await auth.requireEnvAccess(envId);
		if (envDenied) return envDenied;

		const setting = await getContainerStartSchedule(containerName, envId);
		const settingId = setting?.id;

		const deleted = await deleteContainerStartSchedule(containerName, envId);

		if (deleted && settingId) {
			unregisterSchedule(settingId, 'container_start');
		}

		return json({ success: deleted });
	} catch (error) {
		console.error('Failed to delete container start schedule:', error);
		return json({ error: 'Failed to delete container start schedule' }, { status: 500 });
	}
};
