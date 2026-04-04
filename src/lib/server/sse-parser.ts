/**
 * Pure SSE parsing utilities — no server dependencies.
 * Can be safely imported in unit tests and client code.
 */

/**
 * Check if the client prefers JSON over SSE.
 * Returns true when Accept header includes application/json but NOT text/event-stream.
 */
export function prefersJSON(request?: Request): boolean {
	const accept = request?.headers.get('accept') || '';
	return accept.includes('application/json') && !accept.includes('text/event-stream');
}

/**
 * Wrap an SSE Response for JSON-preferring clients.
 *
 * Consumes the SSE stream using proper event framing (blank-line delimited,
 * multi-line data joined with \n, CRLF stripped). Returns the `result` event
 * data as a JSON response, or a fallback if no result event was emitted.
 *
 * Usage:
 *   if (prefersJSON(request)) return sseToJSON(buildSSEResponse());
 *   return buildSSEResponse();
 */
export async function sseToJSON(sseResponse: Response): Promise<Response> {
	const reader = sseResponse.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let eventType = '';
	let dataLines: string[] = [];
	let resultData: unknown = null;

	const dispatch = () => {
		const data = dataLines.join('\n');
		const type = eventType || 'message';
		eventType = '';
		dataLines = [];
		if (type === 'result' && data) {
			try {
				resultData = JSON.parse(data);
			} catch {
				// keep previous resultData
			}
		}
	};

	const parseLine = (rawLine: string) => {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		if (line.startsWith(':')) return;
		if (line === '') { dispatch(); return; }
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let val = colon === -1 ? '' : line.slice(colon + 1);
		if (val.startsWith(' ')) val = val.slice(1);
		if (field === 'event') eventType = val || 'message';
		else if (field === 'data') dataLines.push(val);
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) parseLine(line);
		}

		// Flush remaining bytes and process trailing content
		buffer += decoder.decode();
		if (buffer) {
			for (const line of buffer.split('\n')) parseLine(line);
		}
		// Final dispatch for servers missing trailing blank line
		if (dataLines.length > 0) dispatch();
	} catch {
		// stream error, return what we have
	} finally {
		reader.releaseLock();
	}

	const body = resultData ?? { success: false, error: 'No result' };
	return new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json' }
	});
}
