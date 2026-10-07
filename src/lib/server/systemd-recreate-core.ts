// Pure decision helpers for recreating a Podman Quadlet / systemd-managed container.
// Import-light (no docker/db) so the respawn-detection logic is unit-testable without a
// live Podman socket.

export interface FoundContainer {
	Id: string;
	State: string;
}

/**
 * Classify what a name-lookup found while polling for the unit to respawn the container
 * after a stop. `oldId` is the container we stopped.
 * - 'respawned-running': a NEW id, running -> the recreate succeeded (fresh container
 *   from the unit's `podman run --replace` on the new image).
 * - 'respawned-not-running': a NEW id, not yet/no longer running (created/exited/
 *   restarting) -> respawned but not healthy; keep polling, and on timeout this is a
 *   FAILURE (a crash-loop on the new image must not be reported as success).
 * - 'old-still-there': the id we stopped is still the one under this name -> keep polling.
 * - 'gone': nothing under this name yet -> keep polling.
 */
export function classifyRespawn(
	found: FoundContainer | null,
	oldId: string
): 'respawned-running' | 'respawned-not-running' | 'old-still-there' | 'gone' {
	if (!found) return 'gone';
	if (found.Id === oldId) return 'old-still-there';
	return found.State === 'running' ? 'respawned-running' : 'respawned-not-running';
}

/** Exact-name match filter for a container-list `name` filter (Podman/Docker treat it as regex-contains). */
export function isExactNameMatch(names: string[] | undefined, name: string): boolean {
	return (names || []).some((n) => n.replace(/^\//, '') === name);
}

export type RespawnOutcome =
	| { done: true; ok: true; id: string } // a new container is running -> success
	| { done: false } // keep polling
	| { done: true; ok: false }; // deadline reached without a running new container

/**
 * Decide, from one poll observation, whether to finish or keep polling. Pure so the
 * timeout/success/failure branches are unit-testable without a live socket.
 *
 * A running new-id container is an immediate success. Otherwise we keep polling until the
 * deadline; once reached, we only succeed if the CURRENT observation is a running new-id
 * container - a container that merely appeared but never reached running (crash-loop on a
 * broken new image) is a FAILURE, never a false success.
 */
export function decideRespawnOutcome(
	found: FoundContainer | null,
	oldId: string,
	deadlineReached: boolean
): RespawnOutcome {
	const state = classifyRespawn(found, oldId);
	if (state === 'respawned-running') return { done: true, ok: true, id: found!.Id };
	if (!deadlineReached) return { done: false };
	return { done: true, ok: false };
}
