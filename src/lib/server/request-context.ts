/**
 * Request-scoped context using AsyncLocalStorage.
 *
 * The hook sets the authenticated user (from cookie or Bearer token)
 * and wraps resolve() in requestContext.run(). Downstream code like
 * authorize() reads the pre-resolved user from here instead of
 * re-validating the session.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from './auth';

export interface RequestContext {
	user: AuthenticatedUser | null;
	authEnabled: boolean;
	authMethod: 'cookie' | 'bearer' | 'none';
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
	return requestContext.getStore();
}
