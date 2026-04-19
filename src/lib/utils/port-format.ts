export interface PortMapping {
	publicPort: number;
	privatePort: number;
	display: string;
	isRange?: boolean;
}

interface PortInfo {
	PublicPort?: number;
	PrivatePort?: number;
	publicPort?: number;
	privatePort?: number;
}

/**
 * Format Docker port mappings, collapsing consecutive ranges.
 * Accepts both Docker API format (PublicPort/PrivatePort) and camelCase (publicPort/privatePort).
 * e.g. 8080:8080, 8081:8081, 8082:8082 → 8080-8082:8080-8082
 */
export function formatPorts(ports: PortInfo[] | undefined | null): PortMapping[] {
	if (!ports || ports.length === 0) return [];
	const seen = new Set<string>();
	const individual = ports
		.filter(p => (p.PublicPort || p.publicPort))
		.map(p => ({
			publicPort: p.PublicPort || p.publicPort!,
			privatePort: p.PrivatePort || p.privatePort!,
			display: `${p.PublicPort || p.publicPort}:${p.PrivatePort || p.privatePort}`
		}))
		.filter(p => {
			const key = p.display;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => a.publicPort - b.publicPort);

	// Collapse consecutive port ranges
	if (individual.length <= 1) return individual;

	const result: PortMapping[] = [];
	let rangeStart = individual[0];
	let rangeEnd = individual[0];

	for (let i = 1; i < individual.length; i++) {
		const curr = individual[i];
		const offset = curr.publicPort - rangeStart.publicPort;
		const expectedPrivate = rangeStart.privatePort + offset;
		if (curr.publicPort === rangeEnd.publicPort + 1 && curr.privatePort === expectedPrivate) {
			rangeEnd = curr;
		} else {
			result.push(rangeStart.publicPort === rangeEnd.publicPort
				? rangeStart
				: { publicPort: rangeStart.publicPort, privatePort: rangeStart.privatePort, display: `${rangeStart.publicPort}-${rangeEnd.publicPort}:${rangeStart.privatePort}-${rangeEnd.privatePort}`, isRange: true });
			rangeStart = curr;
			rangeEnd = curr;
		}
	}
	result.push(rangeStart.publicPort === rangeEnd.publicPort
		? rangeStart
		: { publicPort: rangeStart.publicPort, privatePort: rangeStart.privatePort, display: `${rangeStart.publicPort}-${rangeEnd.publicPort}:${rangeStart.privatePort}-${rangeEnd.privatePort}`, isRange: true });

	return result;
}
