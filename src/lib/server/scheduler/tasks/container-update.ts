/**
 * Container Auto-Update Task
 *
 * Handles automatic container updates with vulnerability scanning.
 */

import type { ScheduleTrigger, VulnerabilityCriteria } from '../../db';
import {
	getAutoUpdateSettingById,
	updateAutoUpdateLastChecked,
	updateAutoUpdateLastUpdated,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog,
	saveVulnerabilityScan,
	getCombinedScanForImage
} from '../../db';
import {
	pullImage,
	listContainers,
	inspectContainer,
	createContainer,
	stopContainer,
	removeContainer,
	checkImageUpdateAvailable,
	getTempImageTag,
	isDigestBasedImage,
	getImageIdByTag,
	removeTempImage,
	tagImage
} from '../../docker';
import { getScannerSettings, scanImage, type ScanResult, type VulnerabilitySeverity } from '../../scanner';
import { sendEventNotification } from '../../notifications';
import { parseImageNameAndTag, shouldBlockUpdate, combineScanSummaries, isSystemContainer } from './update-utils';

/**
 * Execute a container auto-update.
 */
export async function runContainerUpdate(
	settingId: number,
	containerName: string,
	environmentId: number | null | undefined,
	triggeredBy: ScheduleTrigger
): Promise<void> {
	const envId = environmentId ?? undefined;
	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'container_update',
		scheduleId: settingId,
		environmentId: environmentId ?? null,
		entityName: containerName,
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = (message: string) => {
		console.log(`[Auto-update] ${message}`);
		appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		log(`Checking container: ${containerName}`);
		await updateAutoUpdateLastChecked(containerName, envId);

		// Find the container
		const containers = await listContainers(true, envId);
		const container = containers.find(c => c.name === containerName);

		if (!container) {
			log(`Container not found: ${containerName}`);
			await updateScheduleExecution(execution.id, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				errorMessage: 'Container not found'
			});
			return;
		}

		// Get the full container config to extract the image name (tag)
		const inspectData = await inspectContainer(container.id, envId) as any;
		const imageNameFromConfig = inspectData.Config?.Image;

		if (!imageNameFromConfig) {
			log(`Could not determine image name from container config`);
			await updateScheduleExecution(execution.id, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				errorMessage: 'Could not determine image name'
			});
			return;
		}

		// Prevent system containers (Dockhand/Hawser) from being updated
		const systemContainerType = isSystemContainer(imageNameFromConfig);
		if (systemContainerType) {
			const reason = systemContainerType === 'dockhand'
				? 'Cannot auto-update Dockhand itself'
				: 'Cannot auto-update Hawser agent';
			log(`Skipping ${systemContainerType} container - ${reason}`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason }
			});
			return;
		}

		// Get the actual image ID from inspect data
		const currentImageId = inspectData.Image;

		log(`Container is using image: ${imageNameFromConfig}`);
		log(`Current image ID: ${currentImageId?.substring(0, 19)}`);

		// Get scanner and schedule settings early to determine scan strategy
		const [scannerSettings, updateSetting] = await Promise.all([
			getScannerSettings(envId),
			getAutoUpdateSettingById(settingId)
		]);

		const vulnerabilityCriteria = (updateSetting?.vulnerabilityCriteria || 'never') as VulnerabilityCriteria;
		// Scan if scanning is enabled (scanner !== 'none')
		// The vulnerabilityCriteria only controls whether to BLOCK updates, not whether to SCAN
		const shouldScan = scannerSettings.scanner !== 'none';

		// =============================================================================
		// SAFE UPDATE FLOW
		// =============================================================================
		// 1. Registry check (no pull) - determine if update is available
		// 2. If scanning enabled:
		//    a. Pull new image (overwrites original tag temporarily)
		//    b. Get new image ID
		//    c. SAFETY: Restore original tag to point to OLD image
		//    d. Tag new image with temp suffix for scanning
		//    e. Scan temp image
		//    f. If blocked: remove temp image, original tag still safe
		//    g. If approved: re-tag to original and proceed
		// 3. If no scanning: simple pull and update
		// =============================================================================

		// Step 1: Check for update using registry check (no pull)
		log(`Checking registry for updates: ${imageNameFromConfig}`);
		const registryCheck = await checkImageUpdateAvailable(imageNameFromConfig, currentImageId, envId);

		// Handle local images or registry errors
		if (registryCheck.isLocalImage) {
			log(`Local image detected - skipping (auto-update requires registry)`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: 'Local image - no registry available' }
			});
			return;
		}

		if (registryCheck.error) {
			log(`Registry check error: ${registryCheck.error}`);
			// Don't fail on transient errors, just skip this run
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: `Registry check failed: ${registryCheck.error}` }
			});
			return;
		}

		if (!registryCheck.hasUpdate) {
			log(`Already up-to-date: ${containerName} is running the latest version`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: 'Already up-to-date' }
			});
			return;
		}

		log(`Update available! Registry digest: ${registryCheck.registryDigest?.substring(0, 19) || 'unknown'}`);

		// Variables for scan results
		let scanResults: ScanResult[] | undefined;
		let scanSummary: VulnerabilitySeverity | undefined;
		let newImageId: string | null = null;
		const newDigest = registryCheck.registryDigest;

		// Step 2: Safe pull with temp tag protection (if scanning enabled)
		if (shouldScan) {
			log(`Safe-pull enabled (scanner: ${scannerSettings.scanner}, criteria: ${vulnerabilityCriteria})`);

			// Check if this is a digest-based image (can't use temp tags)
			if (isDigestBasedImage(imageNameFromConfig)) {
				log(`Digest-based image detected - temp tag protection not available`);
				// Fall through to simple flow
			} else {
				const tempTag = getTempImageTag(imageNameFromConfig);
				log(`Using temp tag for safe pull: ${tempTag}`);

				try {
					// Step 2a: Pull new image (overwrites original tag)
					log(`Pulling new image: ${imageNameFromConfig}`);
					await pullImage(imageNameFromConfig, undefined, envId);

					// Step 2b: Get new image ID
					newImageId = await getImageIdByTag(imageNameFromConfig, envId);
					if (!newImageId) {
						throw new Error('Failed to get new image ID after pull');
					}
					log(`New image pulled: ${newImageId.substring(0, 19)}`);

					// Step 2c: SAFETY - Restore original tag to OLD image
					log(`Restoring original tag to current safe image...`);
					const [oldRepo, oldTag] = parseImageNameAndTag(imageNameFromConfig);
					await tagImage(currentImageId, oldRepo, oldTag, envId);
					log(`Original tag ${imageNameFromConfig} restored to safe image`);

					// Step 2d: Tag new image with temp suffix
					const [tempRepo, tempTagName] = parseImageNameAndTag(tempTag);
					await tagImage(newImageId, tempRepo, tempTagName, envId);
					log(`New image tagged as: ${tempTag}`);

					// Step 2e: Scan temp image
					log(`Scanning new image for vulnerabilities...`);
					try {
						scanResults = await scanImage(tempTag, envId, (progress) => {
							const scannerTag = progress.scanner ? `[${progress.scanner}]` : '[scan]';
							if (progress.message) {
								log(`${scannerTag} ${progress.message}`);
							}
							if (progress.output) {
								log(`${scannerTag} ${progress.output}`);
							}
						});

						if (scanResults.length > 0) {
							scanSummary = combineScanSummaries(scanResults);
							log(`Scan result: ${scanSummary.critical} critical, ${scanSummary.high} high, ${scanSummary.medium} medium, ${scanSummary.low} low`);

							// Save scan results
							for (const result of scanResults) {
								try {
									await saveVulnerabilityScan({
										environmentId: envId ?? null,
										imageId: newImageId,
										imageName: result.imageName,
										scanner: result.scanner,
										scannedAt: result.scannedAt,
										scanDuration: result.scanDuration,
										criticalCount: result.summary.critical,
										highCount: result.summary.high,
										mediumCount: result.summary.medium,
										lowCount: result.summary.low,
										negligibleCount: result.summary.negligible,
										unknownCount: result.summary.unknown,
										vulnerabilities: result.vulnerabilities,
										error: result.error ?? null
									});
								} catch (saveError: any) {
									log(`Warning: Could not save scan results: ${saveError.message}`);
								}
							}

							// Handle 'more_than_current' criteria
							let currentScanSummary: VulnerabilitySeverity | undefined;
							if (vulnerabilityCriteria === 'more_than_current') {
								log(`Looking up cached scan for current image...`);
								try {
									const cachedScan = await getCombinedScanForImage(currentImageId, envId ?? null);
									if (cachedScan) {
										currentScanSummary = cachedScan;
										log(`Cached scan: ${currentScanSummary.critical} critical, ${currentScanSummary.high} high`);
									} else {
										log(`No cached scan found, scanning current image...`);
										const currentScanResults = await scanImage(currentImageId, envId, (progress) => {
											const tag = progress.scanner ? `[${progress.scanner}]` : '[scan]';
											if (progress.message) log(`${tag} ${progress.message}`);
										});
										if (currentScanResults.length > 0) {
											currentScanSummary = combineScanSummaries(currentScanResults);
											log(`Current image: ${currentScanSummary.critical} critical, ${currentScanSummary.high} high`);
											// Save for future use
											for (const result of currentScanResults) {
												try {
													await saveVulnerabilityScan({
														environmentId: envId ?? null,
														imageId: currentImageId,
														imageName: result.imageName,
														scanner: result.scanner,
														scannedAt: result.scannedAt,
														scanDuration: result.scanDuration,
														criticalCount: result.summary.critical,
														highCount: result.summary.high,
														mediumCount: result.summary.medium,
														lowCount: result.summary.low,
														negligibleCount: result.summary.negligible,
														unknownCount: result.summary.unknown,
														vulnerabilities: result.vulnerabilities,
														error: result.error ?? null
													});
												} catch { /* ignore */ }
											}
										}
									}
								} catch (cacheError: any) {
									log(`Warning: Could not get current scan: ${cacheError.message}`);
								}
							}

							// Check if update should be blocked
							const { blocked, reason } = shouldBlockUpdate(vulnerabilityCriteria, scanSummary, currentScanSummary);

							if (blocked) {
								// Step 2f: BLOCKED - Remove temp image, original tag is safe
								log(`UPDATE BLOCKED: ${reason}`);
								log(`Removing blocked image: ${tempTag}`);
								await removeTempImage(newImageId, envId);
								log(`Blocked image removed - container will continue using safe image`);

								await updateScheduleExecution(execution.id, {
									status: 'skipped',
									completedAt: new Date().toISOString(),
									duration: Date.now() - startTime,
									details: {
										mode: 'auto_update',
										reason: 'vulnerabilities_found',
										blockReason: reason,
										vulnerabilityCriteria,
										summary: { checked: 1, updated: 0, blocked: 1, failed: 0 },
										containers: [{
											name: containerName,
											status: 'blocked',
											blockReason: reason,
											scannerResults: scanResults.map(r => ({
												scanner: r.scanner,
												critical: r.summary.critical,
												high: r.summary.high,
												medium: r.summary.medium,
												low: r.summary.low,
												negligible: r.summary.negligible,
												unknown: r.summary.unknown
											}))
										}],
										scanResult: {
											summary: scanSummary,
											scanners: scanResults.map(r => r.scanner),
											scannedAt: scanResults[0]?.scannedAt,
											scannerResults: scanResults.map(r => ({
												scanner: r.scanner,
												critical: r.summary.critical,
												high: r.summary.high,
												medium: r.summary.medium,
												low: r.summary.low,
												negligible: r.summary.negligible,
												unknown: r.summary.unknown
											}))
										}
									}
								});

								await sendEventNotification('auto_update_blocked', {
									title: 'Auto-update blocked',
									message: `Container "${containerName}" update blocked: ${reason}`,
									type: 'warning'
								}, envId);

								return;
							}

							log(`Scan passed vulnerability criteria`);
						}
					} catch (scanError: any) {
						// Scan failure - cleanup temp image and fail
						log(`Scan failed: ${scanError.message}`);
						log(`Removing temp image due to scan failure...`);
						await removeTempImage(newImageId, envId);

						await updateScheduleExecution(execution.id, {
							status: 'failed',
							completedAt: new Date().toISOString(),
							duration: Date.now() - startTime,
							errorMessage: `Vulnerability scan failed: ${scanError.message}`
						});
						return;
					}

					// Step 2g: APPROVED - Re-tag to original for update
					log(`Re-tagging approved image to: ${imageNameFromConfig}`);
					await tagImage(newImageId, oldRepo, oldTag, envId);
					log(`Image ready for update`);

					// Clean up temp tag (optional, image will be removed when container is recreated)
					try {
						await removeTempImage(tempTag, envId);
					} catch { /* ignore cleanup errors */ }

				} catch (pullError: any) {
					log(`Safe-pull failed: ${pullError.message}`);
					await updateScheduleExecution(execution.id, {
						status: 'failed',
						completedAt: new Date().toISOString(),
						duration: Date.now() - startTime,
						errorMessage: `Failed to pull image: ${pullError.message}`
					});
					return;
				}
			}
		} else {
			// No scanning - simple pull
			log(`Pulling update (no vulnerability scan)...`);
			try {
				await pullImage(imageNameFromConfig, undefined, envId);
				log(`Image pulled successfully`);
			} catch (pullError: any) {
				log(`Pull failed: ${pullError.message}`);
				await updateScheduleExecution(execution.id, {
					status: 'failed',
					completedAt: new Date().toISOString(),
					duration: Date.now() - startTime,
					errorMessage: `Failed to pull image: ${pullError.message}`
				});
				return;
			}
		}

		log(`Proceeding with container recreation...`);
		const success = await recreateContainer(containerName, envId, log);

		if (success) {
			await updateAutoUpdateLastUpdated(containerName, envId);
			log(`Successfully updated container: ${containerName}`);
			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: {
					mode: 'auto_update',
					newDigest,
					vulnerabilityCriteria,
					summary: { checked: 1, updated: 1, blocked: 0, failed: 0 },
					containers: [{
						name: containerName,
						status: 'updated',
						scannerResults: scanResults?.map(r => ({
							scanner: r.scanner,
							critical: r.summary.critical,
							high: r.summary.high,
							medium: r.summary.medium,
							low: r.summary.low,
							negligible: r.summary.negligible,
							unknown: r.summary.unknown
						}))
					}],
					scanResult: scanSummary ? {
						summary: scanSummary,
						scanners: scanResults?.map(r => r.scanner) || [],
						scannedAt: scanResults?.[0]?.scannedAt,
						scannerResults: scanResults?.map(r => ({
							scanner: r.scanner,
							critical: r.summary.critical,
							high: r.summary.high,
							medium: r.summary.medium,
							low: r.summary.low,
							negligible: r.summary.negligible,
							unknown: r.summary.unknown
						})) || []
					} : undefined
				}
			});

			// Send notification for successful update
			await sendEventNotification('auto_update_success', {
				title: 'Container auto-updated',
				message: `Container "${containerName}" was updated to a new image version`,
				type: 'success'
			}, envId);
		} else {
			throw new Error('Failed to recreate container');
		}
	} catch (error: any) {
		log(`Error: ${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});

		// Send notification for failed update
		await sendEventNotification('auto_update_failed', {
			title: 'Auto-update failed',
			message: `Container "${containerName}" auto-update failed: ${error.message}`,
			type: 'error'
		}, envId);
	}
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function recreateContainer(
	containerName: string,
	envId?: number,
	log?: (msg: string) => void
): Promise<boolean> {
	try {
		// Find the container by name
		const containers = await listContainers(true, envId);
		const container = containers.find(c => c.name === containerName);

		if (!container) {
			log?.(`Container not found: ${containerName}`);
			return false;
		}

		// Get full container config
		const inspectData = await inspectContainer(container.id, envId) as any;
		const wasRunning = inspectData.State.Running;
		const config = inspectData.Config;
		const hostConfig = inspectData.HostConfig;

		log?.(`Recreating container: ${containerName} (was running: ${wasRunning})`);

		// Stop container if running
		if (wasRunning) {
			log?.('Stopping container...');
			await stopContainer(container.id, envId);
		}

		// Remove old container
		log?.('Removing old container...');
		await removeContainer(container.id, true, envId);

		// Prepare port bindings
		const ports: { [key: string]: { HostPort: string } } = {};
		if (hostConfig.PortBindings) {
			for (const [containerPort, bindings] of Object.entries(hostConfig.PortBindings)) {
				if (bindings && (bindings as any[]).length > 0) {
					ports[containerPort] = { HostPort: (bindings as any[])[0].HostPort || '' };
				}
			}
		}

		// Create new container
		log?.('Creating new container...');
		const newContainer = await createContainer({
			name: containerName,
			image: config.Image,
			ports,
			volumeBinds: hostConfig.Binds || [],
			env: config.Env || [],
			labels: config.Labels || {},
			cmd: config.Cmd || undefined,
			restartPolicy: hostConfig.RestartPolicy?.Name || 'no',
			networkMode: hostConfig.NetworkMode || undefined
		}, envId);

		// Start if was running
		if (wasRunning) {
			log?.('Starting new container...');
			await newContainer.start();
		}

		log?.('Container recreated successfully');
		return true;
	} catch (error: any) {
		log?.(`Failed to recreate container: ${error.message}`);
		return false;
	}
}
