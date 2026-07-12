/**
 * Build a safe `Content-Disposition: attachment` header value (RFC 6266).
 *
 * The filename is often derived from a user-influenced path, so it must never
 * be interpolated raw — a `"` would break out of the quoted string and CR/LF
 * could attempt header injection. We emit both:
 *  - an ASCII-sanitized `filename="..."` fallback (quotes/control chars stripped)
 *  - a percent-encoded `filename*=UTF-8''...` for the real (possibly non-ASCII) name
 */
export function attachmentContentDisposition(filename: string): string {
	const fallback = (filename || 'download')
		// drop control chars (incl. CR/LF) and characters that break the quoted form
		.replace(/[\x00-\x1f\x7f"\\]/g, '')
		.trim() || 'download';

	const encoded = encodeURIComponent(filename || 'download');

	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
