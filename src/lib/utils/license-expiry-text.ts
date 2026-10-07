/**
 * How long is left on a licence, in the words the header uses.
 *
 * Counting whole days rounds the last day up, so an hour left and a full day left read
 * the same. That is the difference between "I will renew tomorrow" and losing
 * enterprise features during the afternoon, so the final day counts down in hours and
 * the final hour in minutes.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole days left, for deciding whether to warn at all and how loudly. */
export function daysLeft(msRemaining: number): number {
	return Math.ceil(msRemaining / DAY);
}

/**
 * What the header says. Null when there is nothing to announce.
 *
 * `msRemaining` is expiry minus now, so a past licence is negative.
 */
export function expiryText(msRemaining: number): string {
	if (msRemaining <= 0) return 'License expired';

	if (msRemaining < HOUR) {
		const minutes = Math.max(1, Math.round(msRemaining / MINUTE));
		return `License expires in ${minutes} ${plural(minutes, 'minute')}`;
	}

	if (msRemaining < DAY) {
		const hours = Math.max(1, Math.floor(msRemaining / HOUR));
		return `License expires in ${hours} ${plural(hours, 'hour')}`;
	}

	// Past the first full day, whole days read better than "in 47 hours".
	const days = Math.floor(msRemaining / DAY);
	if (days === 1) return 'License expires tomorrow';
	return `License expires in ${days} days`;
}

function plural(n: number, word: string): string {
	return n === 1 ? word : `${word}s`;
}

/**
 * Whether the header should count down at all.
 *
 * A licence can stop validating for reasons that have nothing to do with time - moved
 * to a new host, key replaced - and the payload still carries a future date. Counting
 * down then promises days that do not exist and names the wrong remedy, so the header
 * stays quiet and leaves the explanation to whoever knows the real reason. Once the
 * date itself has passed, saying so is right however the licence failed.
 */
export function shouldShowExpiryWarning(state: {
	hasEnterpriseLicense: boolean;
	isEnterprise: boolean;
	msRemaining: number | null;
}): boolean {
	if (!state.hasEnterpriseLicense) return false;
	// A licence that fails for a reason other than time still needs saying, and the
	// reason carries it - there may be no date to count down at all.
	if (!state.isEnterprise) return true;
	if (state.msRemaining === null) return false;
	return daysLeft(state.msRemaining) <= 30;
}

/**
 * What the header says about a licence, or null when there is nothing to say.
 *
 * A licence can fail for reasons that have nothing to do with time - moved to another
 * host, key replaced - and its payload still carries a future date. Counting down
 * there would promise days that do not exist and point at the wrong remedy, so the
 * server's own reason is shown instead. It is what the person who can fix it needs.
 */
export function licenceHeaderText(state: {
	hasEnterpriseLicense: boolean;
	isEnterprise: boolean;
	msRemaining: number | null;
	problem: string | null;
}): string | null {
	if (!shouldShowExpiryWarning(state)) return null;

	// Expiry is the one failure the countdown already words well.
	if (state.isEnterprise || (state.msRemaining !== null && state.msRemaining <= 0)) {
		return state.msRemaining === null ? null : expiryText(state.msRemaining);
	}

	return state.problem ? `License problem: ${state.problem}` : 'License is not valid';
}

/** What the licence endpoint says, reduced to the flags the interface reasons about. */
export interface LicenceFlags {
	/** The licence validates right now, so the paid features are available. */
	isEnterprise: boolean;
	/** An enterprise licence is installed, whether or not it still validates. */
	hasEnterpriseLicense: boolean;
	isLicensed: boolean;
	licenseType: string | null;
	expiresAt: string | null;
	/** Why the licence does not validate, as the server put it. Null when it does. */
	problem: string | null;
}

/**
 * Read the licence endpoint's answer.
 *
 * `isEnterprise` gates the paid features and so must go false the moment a licence
 * stops validating. `hasEnterpriseLicense` answers a different question - is one
 * installed at all - and has to survive that, or the warnings about it disappear
 * exactly when they start being true.
 */
export function deriveLicenceFlags(response: {
	valid?: boolean;
	active?: boolean;
	error?: string | null;
	payload?: { type?: string; expires?: string | null } | null;
}): LicenceFlags {
	const isValid = !!(response.valid && response.active);
	const licenseType = response.payload?.type ?? null;
	return {
		isEnterprise: isValid && licenseType === 'enterprise',
		hasEnterpriseLicense: licenseType === 'enterprise',
		isLicensed: isValid,
		licenseType: isValid ? licenseType : null,
		expiresAt: response.payload?.expires ?? null,
		problem: isValid ? null : (response.error ?? null)
	};
}
