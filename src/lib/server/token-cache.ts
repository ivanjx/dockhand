/**
 * API Token Cache — LRU with TTL
 *
 * In-memory cache for validated API tokens. Without this, every Bearer
 * request would run Argon2id verification (~64MB RAM, ~100ms CPU per call).
 *
 * Cache key is SHA-256(fullToken) — safe to hold in memory (not reversible).
 * TTL is 60s by default, capped at the token's expiry time if sooner.
 *
 * Uses a bounded LRU (max 1024 entries) to cap memory usage. On overflow
 * the least-recently-used entry is evicted. Expired entries are also pruned
 * every 5 minutes.
 *
 * Separated from api-tokens.ts to avoid circular dependencies
 * (auth.ts ↔ api-tokens.ts).
 */

export interface TokenCacheEntry {
	user: { id: number; [key: string]: any };
	expiresAt: number;
}

const MAX_CACHE_SIZE = 1024;

/**
 * Simple LRU cache backed by a Map.
 * Map iteration order is insertion order, so we delete-and-re-set on every
 * access to move the entry to the "newest" position. The oldest entry
 * (Map.keys().next()) is evicted when the cache exceeds MAX_CACHE_SIZE.
 */
class LruTokenCache {
	private map = new Map<string, TokenCacheEntry>();

	get(key: string): TokenCacheEntry | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		// Move to end (most-recently-used)
		this.map.delete(key);
		this.map.set(key, entry);
		return entry;
	}

	set(key: string, entry: TokenCacheEntry): void {
		// If key already exists, delete first so re-insert moves it to end
		if (this.map.has(key)) {
			this.map.delete(key);
		}
		this.map.set(key, entry);
		// Evict oldest if over capacity
		if (this.map.size > MAX_CACHE_SIZE) {
			const oldest = this.map.keys().next().value!;
			this.map.delete(oldest);
		}
	}

	delete(key: string): void {
		this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}

	entries(): IterableIterator<[string, TokenCacheEntry]> {
		return this.map.entries();
	}

	get size(): number {
		return this.map.size;
	}
}

export const tokenCache = new LruTokenCache();

/**
 * Invalidate all cached tokens for a specific user.
 * Call when user permissions change, roles are updated, or user is deleted/deactivated.
 */
export function invalidateTokenCacheForUser(userId: number): void {
	for (const [key, entry] of tokenCache.entries()) {
		if (entry.user.id === userId) {
			tokenCache.delete(key);
		}
	}
}

/**
 * Clear the entire token cache.
 * Called on revocation, role permission edits, and license state changes.
 */
export function clearTokenCache(): void {
	tokenCache.clear();
}

// Periodic cleanup every 5 minutes
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

export function ensureCleanupInterval(): void {
	if (cleanupInterval) return;
	cleanupInterval = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of tokenCache.entries()) {
			if (entry.expiresAt <= now) {
				tokenCache.delete(key);
			}
		}
	}, 5 * 60 * 1000);
	if (cleanupInterval.unref) cleanupInterval.unref();
}
