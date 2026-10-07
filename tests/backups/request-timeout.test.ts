import { describe, it, expect } from 'bun:test';
import { computeRequestTimeoutMs, isPrunePath } from '../../src/lib/server/backups/request-timeout';

const base = { path: '/containers/x/json', streamingBody: false, streamingResponse: false };

describe('computeRequestTimeoutMs - idle-timeout policy', () => {
	it('a normal small request gets the 30s idle timeout', () => {
		expect(computeRequestTimeoutMs(base)).toBe(30000);
	});

	it('a STREAMING BODY (large tar PUT) gets NO timeout, even for a small response (the #9 fix)', () => {
		expect(computeRequestTimeoutMs({ path: '/containers/x/archive', streamingBody: true, streamingResponse: false })).toBeNull();
	});

	it('a STREAMING RESPONSE (logs/events) gets NO timeout', () => {
		expect(computeRequestTimeoutMs({ ...base, streamingResponse: true })).toBeNull();
	});

	it('a prune request gets 300s (it can take a while)', () => {
		expect(computeRequestTimeoutMs({ ...base, path: '/images/prune' })).toBe(300000);
		expect(computeRequestTimeoutMs({ ...base, path: '/containers/prune' })).toBe(300000);
	});

	it('an image prune WITH a filters query still gets 300s (#1630)', () => {
		const path = '/images/prune?filters=%7B%22dangling%22%3A%5B%22true%22%5D%7D';
		expect(computeRequestTimeoutMs({ ...base, path })).toBe(300000);
		expect(isPrunePath(path)).toBe(true);
	});

	it('a query string alone never enables the prune timeout', () => {
		expect(computeRequestTimeoutMs({ ...base, path: '/images/json?filters=/prune' })).toBe(30000);
		expect(isPrunePath('/images/json?x=/prune')).toBe(false);
		expect(isPrunePath('/images/json')).toBe(false);
	});

	it('a compose operation gets the COMPOSE_TIMEOUT (default 900s)', () => {
		expect(computeRequestTimeoutMs({ ...base, path: '/_hawser/compose' })).toBe(900000);
		expect(computeRequestTimeoutMs({ ...base, path: '/_hawser/compose', composeTimeoutSecs: 1800 })).toBe(1800000);
	});

	it('streaming beats the path-based bumps (a streamed prune/compose still has no timeout)', () => {
		expect(computeRequestTimeoutMs({ path: '/containers/prune', streamingBody: true, streamingResponse: false })).toBeNull();
		expect(computeRequestTimeoutMs({ path: '/_hawser/compose', streamingBody: false, streamingResponse: true })).toBeNull();
	});
});
