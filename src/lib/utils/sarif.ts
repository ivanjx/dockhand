/**
 * Build a schema-valid SARIF 2.1.0 document from Dockhand vulnerability findings,
 * for ingestion by DefectDojo / GitHub code scanning / Dependency-Track (#415).
 *
 * SARIF 2.1.0 is a frozen OASIS standard, so we hand-build the object literal
 * against the @types/sarif types rather than take a runtime dependency.
 */
import type { Log, Run, Result, ReportingDescriptor } from 'sarif';
import type { Finding } from '$lib/utils/vulnerability';

const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

/** Map a Dockhand severity to a SARIF result level. */
function sarifLevel(severity: string): Result.level {
	switch (severity.toLowerCase()) {
		case 'critical':
		case 'high':
			return 'error';
		case 'medium':
			return 'warning';
		case 'low':
		case 'negligible':
			return 'note';
		default:
			return 'none';
	}
}

/**
 * A repo-relative artifact URI for a package inside an image.
 *
 * SARIF's artifactLocation.uri is a uri-reference; consumers (GitHub code
 * scanning especially) resolve it against a base and drop results whose URI is
 * an *absolute* URI. An image ref like `nginx:latest` would make `nginx:` parse
 * as a URI scheme, so we prefix a constant `images/` segment (guaranteeing the
 * first path segment has no colon) and percent-encode each segment.
 */
function artifactUri(imageName: string, pkg: string): string {
	return `images/${encodeURIComponent(imageName)}/${encodeURIComponent(pkg)}`;
}

/** GitHub/DefectDojo read `security-severity` (0-10) from rule properties. */
function securitySeverityScore(severity: string): string {
	switch (severity.toLowerCase()) {
		case 'critical': return '9.5';
		case 'high': return '8.0';
		case 'medium': return '5.5';
		case 'low': return '3.0';
		default: return '0.0';
	}
}

export interface SarifOptions {
	toolName?: string;
	toolVersion?: string;
	informationUri?: string;
}

/**
 * Convert findings into a SARIF log with a single run. Each unique CVE becomes a
 * reporting descriptor (rule); each finding becomes a result located at the
 * affected package within its image.
 */
export function findingsToSarif(findings: Finding[], opts: SarifOptions = {}): Log {
	const toolName = opts.toolName ?? 'Dockhand';
	// __APP_VERSION__ is a Vite define (git tag / VERSION file); guard for non-Vite
	// contexts such as `bun test`.
	const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
	const toolVersion = opts.toolVersion ?? appVersion ?? 'unknown';
	const informationUri = opts.informationUri ?? 'https://github.com/Finsys/dockhand';

	// One rule per distinct CVE — dedupe, keeping the most detailed description/link.
	const ruleMap = new Map<string, ReportingDescriptor>();
	for (const f of findings) {
		if (ruleMap.has(f.cve)) continue;
		ruleMap.set(f.cve, {
			id: f.cve,
			name: f.cve,
			shortDescription: { text: `${f.cve} in ${f.package}` },
			fullDescription: { text: f.description || `${f.cve} affecting ${f.package}` },
			helpUri: f.link || `https://nvd.nist.gov/vuln/detail/${f.cve}`,
			defaultConfiguration: { level: sarifLevel(f.severity) },
			properties: {
				// GitHub code scanning / DefectDojo read the hyphenated key off the rule.
				'security-severity': securitySeverityScore(f.severity),
				tags: ['vulnerability', 'security', f.severity.toLowerCase()]
			}
		});
	}

	const results: Result[] = findings.map((f) => {
		const fixText = f.fixedVersion ? `Fixed in ${f.fixedVersion}.` : 'No fix available.';
		return {
			ruleId: f.cve,
			level: sarifLevel(f.severity),
			message: {
				text: `${f.severity.toUpperCase()} ${f.cve} in ${f.package} ${f.installedVersion} (image ${f.imageName}). ${fixText}`
			},
			locations: [
				{
					physicalLocation: {
						artifactLocation: {
							// Repo-relative URI identifying the vulnerable package inside the
							// image (see artifactUri: image refs contain colons, which must not
							// be read as a URI scheme).
							uri: artifactUri(f.imageName, f.package)
						}
					},
					logicalLocations: [
						{ name: f.package, kind: 'package', fullyQualifiedName: `${f.imageName}/${f.package}@${f.installedVersion}` }
					]
				}
			],
			partialFingerprints: {
				// Custom stable fingerprint so re-imports dedupe: image|cve|package|version.
				// (Not primaryLocationLineHash — that reserved key has hash semantics.)
				dockhandFinding: `${f.imageId}|${f.cve}|${f.package}|${f.installedVersion}`
			},
			properties: {
				imageName: f.imageName,
				imageId: f.imageId,
				package: f.package,
				installedVersion: f.installedVersion,
				fixedVersion: f.fixedVersion || null,
				severity: f.severity,
				scannedAt: f.scannedAt || null,
				containers: (f.containers ?? []).map((c) => c.name),
				stacks: f.stacks ?? []
			}
		};
	});

	const run: Run = {
		tool: {
			driver: {
				name: toolName,
				version: toolVersion,
				informationUri,
				rules: Array.from(ruleMap.values())
			}
		},
		results
	};

	return {
		version: '2.1.0',
		$schema: SARIF_SCHEMA,
		runs: [run]
	};
}
