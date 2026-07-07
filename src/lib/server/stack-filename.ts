/**
 * Filename gate for stack writes (#1196).
 *
 * Lives in its own file so unit tests can import the helper without pulling
 * in stacks.ts (which transitively imports the DB layer and won't load
 * under bun:test).
 *
 * v1.0.34 locked compose/env paths to a hardcoded set (docker-compose.yml,
 * compose.yml, .env) which broke users who name their compose files after
 * the service (e.g. `headscale.yml`). v1.0.35 relaxes to any .yml / .yaml
 * file plus the `.env` family. The load-bearing security control is the
 * containment + symlink-realpath + traversal checks in validateStackPath() —
 * this gate is belt-and-suspenders to keep the write path producing
 * stack-shaped files. Still blocks authorized_keys, evil.sh, /etc/cron.d/x.
 */

// Matches: foo.yml, foo.yaml, .env, foo.env, .env.local, prod.env.staging
export const STACK_FILENAME_RE = /\.ya?ml$|(^|\.)env(\.|$)/;

export function isAllowedStackFilename(filename: string): boolean {
	return STACK_FILENAME_RE.test(filename);
}
