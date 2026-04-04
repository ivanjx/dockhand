import { json } from '@sveltejs/kit';
import { createJob, appendLine, completeJob, failJob } from '$lib/server/jobs';
import { prefersJSON } from '$lib/server/sse-parser';

// Re-export pure parsing utilities (no server deps) for backward compat
export { prefersJSON, sseToJSON } from '$lib/server/sse-parser';

/**
 * Job-based response for long-running operations.
 *
 * Backward compat: API clients that send `Accept: application/json` (and not
 * `text/event-stream`) get a synchronous JSON result directly.
 *
 * All other clients receive `{ jobId }` immediately. The operation runs in the
 * background and results accumulate in the job store. Clients poll /api/jobs/{id}.
 *
 * The send() callback stores lines with { event, data } so the polling client
 * can reconstruct the same event stream semantics used by the old SSE flow.
 */
export function createJobResponse(
	operation: (send: (event: string, data: unknown) => void) => Promise<void>,
	request?: Request
): Response {
	// Backward compat: synchronous JSON path for explicit application/json callers
	if (prefersJSON(request)) {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				let resultData: unknown = { success: false, error: 'No result' };
				const send = (_event: string, data: unknown) => {
					resultData = data;
				};
				try {
					await operation(send);
				} catch (error) {
					resultData = { success: false, error: String(error) };
				}
				controller.enqueue(encoder.encode(JSON.stringify(resultData)));
				controller.close();
			}
		});
		return new Response(stream, {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Fire and forget: create job, run operation in background, return jobId immediately
	const job = createJob();

	const send = (event: string, data: unknown) => {
		appendLine(job, { event, data });
	};

	operation(send)
		.then(() => {
			const resultLine = job.lines.findLast((l) => l.event === 'result');
			completeJob(job, resultLine?.data ?? { success: true });
		})
		.catch((err: unknown) => {
			failJob(job, err instanceof Error ? err.message : String(err));
		});

	return json({ jobId: job.id });
}
