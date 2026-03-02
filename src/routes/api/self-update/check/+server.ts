import { json } from '@sveltejs/kit';
import { authorize } from '$lib/server/authorize';
import { getOwnContainerId } from '$lib/server/host-path';
import { getRegistryManifestDigest, unixSocketRequest } from '$lib/server/docker';
import { compareVersions } from '$lib/utils/version';
import type { RequestHandler } from './$types';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

/** Fetch from the local Docker socket directly (not through environment routing) */
function localDockerFetch(path: string, options: RequestInit = {}): Promise<Response> {
	return unixSocketRequest(DOCKER_SOCKET, path, options);
}

/**
 * Check if a Dockhand update is available.
 * Admin-only. Auto-checked when Settings > About is opened.
 *
 * Uses localDockerFetch exclusively to avoid environment routing issues
 * when the image comes from a private registry.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: 'Admin access required' }, { status: 403 });
	}

	const containerId = getOwnContainerId();
	if (!containerId) {
		return json({
			updateAvailable: false,
			error: 'Not running in Docker'
		});
	}

	try {
		// Inspect own container to get current image info
		const inspectResponse = await localDockerFetch(`/containers/${containerId}/json`);
		if (!inspectResponse.ok) {
			return json({
				updateAvailable: false,
				error: 'Failed to inspect own container'
			});
		}

		const inspectData = await inspectResponse.json() as {
			Config?: { Image?: string; Labels?: Record<string, string> };
			Image?: string;
			Name?: string;
		};

		const currentImage = inspectData.Config?.Image || '';
		const currentImageId = inspectData.Image || '';
		const containerName = inspectData.Name?.replace(/^\//, '') || '';

		if (!currentImage) {
			return json({
				updateAvailable: false,
				error: 'Could not determine current image'
			});
		}

		// Detect if managed by Docker Compose
		const isComposeManaged = !!inspectData.Config?.Labels?.['com.docker.compose.project'];

		// Digest-based images (e.g. image@sha256:...) can't be checked for updates
		if (currentImage.includes('@sha256:')) {
			return json({
				updateAvailable: false,
				currentImage,
				currentDigest: currentImage.split('@')[1],
				containerName,
				isComposeManaged
			});
		}

		// Extract tag from image name
		const colonIdx = currentImage.lastIndexOf(':');
		const tag = colonIdx > -1 ? currentImage.substring(colonIdx + 1) : 'latest';
		const imageWithoutTag = colonIdx > -1 ? currentImage.substring(0, colonIdx) : currentImage;

		// Check if this is a versioned tag (e.g., v1.0.18, 1.0.18, v1.0.18-baseline)
		const versionMatch = tag.match(/^(v?\d+\.\d+\.\d+)(-baseline)?$/);

		if (versionMatch) {
			// Version-based check: compare against latest released version from changelog
			const currentTagVersion = versionMatch[1];
			const suffix = versionMatch[2] || ''; // '-baseline' or ''

			try {
				const changelogResponse = await fetch(
					'https://raw.githubusercontent.com/Finsys/dockhand/main/src/lib/data/changelog.json',
					{ signal: AbortSignal.timeout(5000) }
				);

				if (!changelogResponse.ok) {
					return json({
						updateAvailable: false,
						currentImage,
						containerName,
						isComposeManaged,
						error: 'Could not fetch changelog from GitHub'
					});
				}

				const changelog = await changelogResponse.json() as Array<{
					version: string;
					comingSoon?: boolean;
					date?: string;
					changes?: Array<{ type: string; text: string }>;
				}>;

				// Find latest released version (first entry without comingSoon)
				const latestRelease = changelog.find(entry => !entry.comingSoon);

				if (!latestRelease) {
					return json({
						updateAvailable: false,
						currentImage,
						containerName,
						isComposeManaged,
						error: 'No released version found in changelog'
					});
				}

				const latestVersion = latestRelease.version;
				const hasNewer = compareVersions(latestVersion, currentTagVersion) > 0;

				if (hasNewer) {
					// Build new image tag preserving registry prefix and suffix
					const newTag = `v${latestVersion.replace(/^v/, '')}${suffix}`;
					const newImage = `${imageWithoutTag}:${newTag}`;

					return json({
						updateAvailable: true,
						currentImage,
						newImage,
						latestVersion: latestVersion.replace(/^v/, ''),
						containerName,
						isComposeManaged
					});
				}

				return json({
					updateAvailable: false,
					currentImage,
					containerName,
					isComposeManaged
				});
			} catch (err) {
				return json({
					updateAvailable: false,
					currentImage,
					containerName,
					isComposeManaged,
					error: 'Version check failed: ' + String(err)
				});
			}
		}

		// Digest-based check for mutable tags (:latest, :baseline, etc.)

		// Inspect image via local Docker socket to get RepoDigests
		const imageResponse = await localDockerFetch(`/images/${encodeURIComponent(currentImageId)}/json`);
		if (!imageResponse.ok) {
			return json({
				updateAvailable: false,
				currentImage,
				containerName,
				isComposeManaged,
				error: 'Could not inspect current image'
			});
		}

		const imageInfo = await imageResponse.json() as { RepoDigests?: string[] };
		const repoDigests = imageInfo.RepoDigests || [];

		// Extract local digests from RepoDigests entries (format: "registry/image@sha256:...")
		const localDigests = repoDigests
			.map((rd: string) => {
				const at = rd.lastIndexOf('@');
				return at > -1 ? rd.substring(at + 1) : null;
			})
			.filter(Boolean) as string[];

		if (localDigests.length === 0) {
			return json({
				updateAvailable: false,
				currentImage,
				newImage: currentImage,
				containerName,
				isComposeManaged,
				isLocalImage: true
			});
		}

		// Query registry for latest digest
		const registryDigest = await getRegistryManifestDigest(currentImage);
		if (!registryDigest) {
			return json({
				updateAvailable: false,
				currentImage,
				newImage: currentImage,
				containerName,
				isComposeManaged,
				error: 'Could not query registry'
			});
		}

		const hasUpdate = !localDigests.includes(registryDigest);

		return json({
			updateAvailable: hasUpdate,
			currentImage,
			newImage: currentImage,
			currentDigest: localDigests[0],
			newDigest: registryDigest,
			containerName,
			isComposeManaged
		});
	} catch (err) {
		return json({
			updateAvailable: false,
			error: 'Check failed: ' + String(err)
		});
	}
};
