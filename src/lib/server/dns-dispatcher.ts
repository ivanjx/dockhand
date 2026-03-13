import { setGlobalDispatcher, Agent } from 'undici';
import dns from 'node:dns';
import net from 'node:net';

const origLookup = dns.lookup.bind(dns);

// DNS cache: hostname → { address, family, expiresAt } (positive)
// DNS negative cache: hostname → { error, expiresAt } (failed lookups)
const dnsCache = new Map<string, { address: string; family: number; expiresAt: number }>();
const dnsNegCache = new Map<string, { error: Error; expiresAt: number }>();
const DNS_TTL_MS = 30_000;
const DNS_NEG_TTL_MS = 10_000; // Cache failures for 10s to prevent DNS server storms

// In-flight deduplication: hostname → pending Promise<{address, family}>
const inFlight = new Map<string, Promise<{ address: string; family: number }>>();

function lookupWithCache(hostname: string): Promise<{ address: string; family: number }> {
	// Positive cache hit
	const cached = dnsCache.get(hostname);
	if (cached) {
		if (cached.expiresAt > Date.now()) {
			return Promise.resolve({ address: cached.address, family: cached.family });
		}
		dnsCache.delete(hostname); // evict stale entry
	}

	// Negative cache hit — don't hammer DNS for recently-failed hostnames
	const negCached = dnsNegCache.get(hostname);
	if (negCached) {
		if (negCached.expiresAt > Date.now()) {
			return Promise.reject(negCached.error);
		}
		dnsNegCache.delete(hostname);
	}

	// In-flight deduplication
	const pending = inFlight.get(hostname);
	if (pending) return pending;

	// Use getaddrinfo (libc) as primary — works through Docker's embedded DNS (127.0.0.11)
	// and respects --dns-result-order=ipv4first from entrypoint. This matches Bun's native
	// behavior which worked reliably on NAS environments where c-ares failed (#676).
	const promise = new Promise<{ address: string; family: number }>((resolve, reject) => {
		origLookup(hostname, { all: false }, (err, address, family) => {
			if (err) {
				// Cache the failure so parallel/subsequent requests don't all hammer DNS
				dnsNegCache.set(hostname, { error: err, expiresAt: Date.now() + DNS_NEG_TTL_MS });
				reject(err);
			} else {
				const result = { address: address as string, family: family as number };
				dnsCache.set(hostname, { ...result, expiresAt: Date.now() + DNS_TTL_MS });
				resolve(result);
			}
		});
	}).finally(() => {
		inFlight.delete(hostname);
	});

	inFlight.set(hostname, promise);
	return promise;
}

setGlobalDispatcher(
	new Agent({
		connect: {
			// Undici default is 10s. Increase to 30s for NAS environments with slow NAT/firewalls (#676).
			timeout: 30_000,
			lookup(hostname: string, opts: any, cb: any) {
				if (typeof opts === 'function') {
					cb = opts;
					opts = {};
				}

				// IP addresses / localhost → no DNS needed
				if (net.isIP(hostname) || hostname === 'localhost') {
					return origLookup(hostname, opts, cb);
				}

				lookupWithCache(hostname)
					.then(({ address, family }) => {
						if (opts.all) {
							cb(null, [{ address, family }]);
						} else {
							cb(null, address, family);
						}
					})
					.catch((err) => cb(err));
			}
		}
	})
);
