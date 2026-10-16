// @ts-expect-error -- bun:test is a runtime built-in with no types installed
import { expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { toOpenApiPath } from '../scripts/openapi/lib';

test('nested dynamic routes use URL separators rather than filesystem separators', () => {
	const routesRoot = resolve('src', 'routes');
	const serverFile = join(routesRoot, 'api', 'schedules', '[type]', '[id]', '+server.ts');

	expect(toOpenApiPath(serverFile, routesRoot)).toEqual({
		path: '/api/schedules/{type}/{id}',
		params: ['type', 'id']
	});
});
