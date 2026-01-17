/**
 * Host Path Resolution Module
 *
 * Dockhand runs inside a Docker container where paths differ from the host.
 * This module detects the host path for the DATA_DIR mount, enabling proper
 * volume path resolution for compose stacks.
 *
 * Problem:
 * - Dockhand container has /app/data mounted from host (e.g., -v dockhand_data:/app/data)
 * - Compose file says: ./ca.pem:/ca.pem (relative path)
 * - docker-compose resolves this to /app/data/stacks/.../ca.pem
 * - Docker daemon on HOST receives this path, but /app/data doesn't exist on host!
 * - Docker creates a directory instead of mounting the file
 *
 * Solution:
 * - Query Docker API to find the host source path for our /app/data mount
 * - Rewrite relative paths in compose files to use the host path
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Cache the host data dir to avoid repeated API calls
let cachedHostDataDir: string | null = null;
let detectionAttempted = false;

/**
 * Get our own container ID
 */
function getOwnContainerId(): string | null {
	// Method 1: From cgroup (works in most cases)
	try {
		const cgroup = readFileSync('/proc/self/cgroup', 'utf-8');
		// Look for docker container ID (64 hex chars)
		const match = cgroup.match(/[a-f0-9]{64}/);
		if (match) {
			return match[0];
		}
	} catch {
		// Can't read cgroup
	}

	// Method 2: From mountinfo
	try {
		const mountinfo = readFileSync('/proc/self/mountinfo', 'utf-8');
		const match = mountinfo.match(/\/docker\/containers\/([a-f0-9]{64})/);
		if (match) {
			return match[1];
		}
	} catch {
		// Can't read mountinfo
	}

	// Method 3: HOSTNAME might be container ID (short form)
	const hostname = process.env.HOSTNAME;
	if (hostname && /^[a-f0-9]{12}$/.test(hostname)) {
		return hostname;
	}

	return null;
}

/**
 * Get the host path for our DATA_DIR mount by inspecting our own container
 */
export async function detectHostDataDir(): Promise<string | null> {
	// Return cached value if already detected
	if (detectionAttempted) {
		return cachedHostDataDir;
	}
	detectionAttempted = true;

	// Check if user explicitly set HOST_DATA_DIR
	if (process.env.HOST_DATA_DIR) {
		cachedHostDataDir = process.env.HOST_DATA_DIR;
		console.log(`[HostPath] Using HOST_DATA_DIR from environment: ${cachedHostDataDir}`);
		return cachedHostDataDir;
	}

	const containerId = getOwnContainerId();
	if (!containerId) {
		console.warn('[HostPath] Running in Docker but could not detect container ID');
		return null;
	}

	console.log(`[HostPath] Detected container ID: ${containerId.substring(0, 12)}`);

	// Get DATA_DIR (inside container)
	const dataDir = resolve(process.env.DATA_DIR || '/app/data');

	try {
		// Query Docker API to inspect our own container
		const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

		// Use fetch with unix socket
		const response = await fetch(`http://localhost/containers/${containerId}/json`, {
			// @ts-ignore - Bun supports unix sockets
			unix: socketPath
		});

		if (!response.ok) {
			console.warn(`[HostPath] Failed to inspect container: ${response.status}`);
			return null;
		}

		const containerInfo = await response.json() as {
			Mounts?: Array<{
				Type: string;
				Source: string;
				Destination: string;
			}>;
		};

		// Find the mount for our DATA_DIR
		const dataMount = containerInfo.Mounts?.find(m => m.Destination === dataDir);

		if (dataMount) {
			cachedHostDataDir = dataMount.Source;
			console.log(`[HostPath] Detected host path for ${dataDir}: ${cachedHostDataDir}`);
			return cachedHostDataDir;
		}

		// Check if DATA_DIR is a subdirectory of a mount
		for (const mount of containerInfo.Mounts || []) {
			if (dataDir.startsWith(mount.Destination + '/') || dataDir === mount.Destination) {
				const relativePath = dataDir.substring(mount.Destination.length);
				cachedHostDataDir = mount.Source + relativePath;
				console.log(`[HostPath] Detected host path for ${dataDir} via parent mount: ${cachedHostDataDir}`);
				return cachedHostDataDir;
			}
		}

		console.warn(`[HostPath] Could not find mount for ${dataDir} in container mounts`);
		return null;
	} catch (err) {
		console.warn(`[HostPath] Failed to query Docker API: ${err}`);
		return null;
	}
}

/**
 * Get the cached host data dir (call detectHostDataDir first during startup)
 */
export function getHostDataDir(): string | null {
	return cachedHostDataDir;
}

/**
 * Translate a container path to host path
 *
 * @param containerPath - Path inside the container (e.g., /app/data/stacks/mystack/file.txt)
 * @returns Host path if translation is needed, or original path if not
 */
export function translateToHostPath(containerPath: string): string {
	const hostDataDir = getHostDataDir();
	if (!hostDataDir) {
		return containerPath;
	}

	const dataDir = resolve(process.env.DATA_DIR || '/app/data');

	// Check if the path is under DATA_DIR
	if (containerPath.startsWith(dataDir + '/') || containerPath === dataDir) {
		const relativePath = containerPath.substring(dataDir.length);
		return hostDataDir + relativePath;
	}

	return containerPath;
}

/**
 * Rewrite relative volume paths in a compose file to use absolute host paths.
 * This is necessary when Dockhand runs inside Docker with a mounted data volume.
 *
 * Transforms:
 *   ./config.toml:/config.toml  ->  /host/path/to/stack/config.toml:/config.toml
 *
 * @param composeContent - The compose file content
 * @param workingDir - The working directory (container path) where the compose file is located
 * @returns Modified compose content with absolute host paths, or original if no translation needed
 */
export function rewriteComposeVolumePaths(composeContent: string, workingDir: string): { content: string; modified: boolean; changes: string[] } {
	const hostDataDir = getHostDataDir();
	const changes: string[] = [];

	if (!hostDataDir) {
		return { content: composeContent, modified: false, changes };
	}

	const dataDir = resolve(process.env.DATA_DIR || '/app/data');

	// Check if workingDir is under DATA_DIR
	if (!workingDir.startsWith(dataDir + '/') && workingDir !== dataDir) {
		return { content: composeContent, modified: false, changes };
	}

	// Calculate the host working directory
	const relativePath = workingDir.substring(dataDir.length);
	const hostWorkingDir = hostDataDir + relativePath;

	// Parse compose content line by line to find and rewrite volume mounts
	// We look for patterns like:
	//   - ./something:/container/path
	//   - "./something:/container/path"
	//   - './something:/container/path'
	const lines = composeContent.split('\n');
	const modifiedLines: string[] = [];

	for (const line of lines) {
		// Match volume mount patterns with relative paths
		// Handles: - ./path:/dest, - "./path:/dest", - './path:/dest'
		const volumeMatch = line.match(/^(\s*-\s*)(['"]?)(\.\/[^'":\s]+)(\2)(:.+)$/);

		if (volumeMatch) {
			const [, prefix, quote, relativeSrc, , destPart] = volumeMatch;
			// Convert relative path to absolute host path
			const absoluteHostPath = hostWorkingDir + '/' + relativeSrc.substring(2); // Remove ./

			const newLine = `${prefix}${absoluteHostPath}${destPart}`;
			modifiedLines.push(newLine);
			changes.push(`  ${relativeSrc} -> ${absoluteHostPath}`);
		} else {
			modifiedLines.push(line);
		}
	}

	return {
		content: modifiedLines.join('\n'),
		modified: changes.length > 0,
		changes
	};
}
