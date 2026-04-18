import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inspectContainer } from '$lib/server/docker';
import { getSecretKeyNames } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'inspect', envIdNum)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const containerData = await inspectContainer(params.id, envIdNum);

		// Mask secret env vars for containers belonging to a Compose stack
		const stackName = containerData.Config?.Labels?.['com.docker.compose.project'];
		if (stackName && Array.isArray(containerData.Config?.Env)) {
			const secretKeys = await getSecretKeyNames(stackName, envIdNum);
			if (secretKeys.size > 0) {
				containerData.Config.Env = containerData.Config.Env.map((entry: string) => {
					const eqIdx = entry.indexOf('=');
					if (eqIdx === -1) return entry;
					const key = entry.substring(0, eqIdx);
					if (secretKeys.has(key)) {
						return `${key}=***`;
					}
					return entry;
				});
			}
		}

		return json(containerData);
	} catch (error) {
		console.error('Failed to inspect container:', error);
		return json({ error: 'Failed to inspect container' }, { status: 500 });
	}
};
