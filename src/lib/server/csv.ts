/** Shared CSV helpers for export endpoints. */

/**
 * Escape a value for a CSV cell:
 *  - Neutralize spreadsheet formula injection: a cell whose first character is
 *    `=`, `+`, `-`, `@`, tab or CR is executed as a formula by Excel/Sheets.
 *    Exported vuln reports carry scanner/image-derived strings (an image tag or
 *    package name could start with `=`), so we prefix such cells with a single
 *    quote to force them to be treated as text.
 *  - Quote per RFC-4180 when the value contains a comma, quote, CR or LF.
 */
export function escapeCSV(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return '';
	let str = String(value);
	if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
	if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

/** Build a CSV document from a header row and pre-escaped/raw cell rows. */
export function rowsToCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
	return [headers.join(','), ...rows.map((row) => row.map(escapeCSV).join(','))].join('\n');
}
