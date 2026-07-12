/**
 * Generic sliding-window list for server-backed virtual grids.
 *
 * Holds at most `windowSize` items in memory regardless of the total row count,
 * so large datasets don't blow up browser memory. Pairs directly with the
 * DataGrid virtual-scroll windowing props:
 *
 *   <DataGrid data={list.items} virtualScroll windowed
 *             dataOffset={list.offset} virtualTotal={list.total}
 *             onWindowShift={list.shiftTo} loading={list.loading} />
 *
 * You supply one `fetchPage(offset, limit, signal)` that returns `{ items, total }`.
 * The primitive owns the window offset, abort/generation guarding of superseded
 * fetches, and centering the window on the requested scroll position.
 *
 * The fetch orchestration lives in `WindowedListCore` (plain, unit-testable);
 * `createWindowedList` is a thin Svelte-runes adapter over it.
 */

export interface WindowPage<T> {
	items: T[];
	total: number;
}

/** State snapshot pushed to observers whenever the window changes. */
export interface WindowState<T> {
	items: T[];
	offset: number;
	total: number;
	loading: boolean;
	loaded: boolean;
}

export interface WindowedListOptions<T> {
	/** Fetch one contiguous slice. Must honor `signal` for cancellation. */
	fetchPage: (offset: number, limit: number, signal: AbortSignal) => Promise<WindowPage<T>>;
	/** Rows kept in memory at once (default 400). */
	windowSize?: number;
	/** Called on fetch error (non-abort). */
	onError?: (error: unknown) => void;
}

/**
 * The absolute offset at which to start a window so it's centered on `targetStart`,
 * clamped to [0, ...). Pure — unit-tested independently of the reactive factory.
 */
export function windowOffsetFor(targetStart: number, windowSize: number): number {
	return Math.max(0, targetStart - Math.floor(windowSize / 2));
}

/**
 * Framework-agnostic core: owns the window offset, abort/generation guarding, and
 * centering. Pushes a fresh WindowState to `onState` whenever anything changes.
 * No Svelte runes, so it's fully unit-testable.
 */
export class WindowedListCore<T> {
	private windowSize: number;
	private controller: AbortController | null = null;
	private generation = 0;
	/** Absolute offset of the currently in-flight fetch, or null when idle. */
	private inflightDesired: number | null = null;

	items: T[] = [];
	offset = 0;
	total = 0;
	loading = false;
	loaded = false;

	constructor(
		private options: WindowedListOptions<T>,
		private onState: (s: WindowState<T>) => void = () => {}
	) {
		this.windowSize = options.windowSize ?? 400;
	}

	private emit() {
		this.onState({
			items: this.items,
			offset: this.offset,
			total: this.total,
			loading: this.loading,
			loaded: this.loaded
		});
	}

	/**
	 * Shift/center the window on an absolute row index.
	 *
	 * `force` bypasses the same-offset dedupe: a scroll fling emits shiftTo per
	 * frame and we skip an identical in-flight offset (fling case), but a
	 * data-invalidating reset (filter/sort change) maps to the SAME offset while
	 * the underlying dataset differs, so it must NOT be deduped — it aborts the
	 * stale in-flight fetch and refetches with the new query.
	 */
	async shiftTo(targetStart: number, force = false): Promise<void> {
		const desired = windowOffsetFor(targetStart, this.windowSize);
		// A fling emits shiftTo per scroll frame; without this every frame would
		// abort the in-flight request and start an identical one. If the same
		// offset is already loading, let it finish instead of thrashing the network.
		// `force` skips this so a reset refetches even at the same offset.
		if (!force && this.loading && desired === this.inflightDesired) return;
		const gen = ++this.generation;
		this.controller?.abort();
		this.controller = new AbortController();
		this.loading = true;
		this.inflightDesired = desired;
		this.emit();
		try {
			const page = await this.options.fetchPage(desired, this.windowSize, this.controller.signal);
			if (gen !== this.generation) return; // superseded by a newer fetch
			this.total = page.total;
			this.items = page.items;
			this.offset = desired;
			this.loaded = true;
		} catch (error) {
			if ((error as Error)?.name !== 'AbortError') this.options.onError?.(error);
		} finally {
			if (gen === this.generation) {
				this.loading = false;
				this.inflightDesired = null;
				this.emit();
			}
		}
	}

	/** Reset to the first window (filter/sort/dataset change). Forces a refetch
	 *  even if an offset-0 load is already in flight for the previous query. */
	reset(): Promise<void> {
		return this.shiftTo(0, true);
	}

	/** Clear all state without fetching. */
	clear(): void {
		this.controller?.abort();
		this.generation++;
		this.items = [];
		this.offset = 0;
		this.total = 0;
		this.loaded = false;
		this.loading = false;
		this.inflightDesired = null;
		this.emit();
	}
}

export interface WindowedList<T> {
	readonly items: T[];
	readonly offset: number;
	readonly total: number;
	readonly loading: boolean;
	readonly loaded: boolean;
	shiftTo: (targetStart: number) => void;
	reset: () => void;
	clear: () => void;
}

/** Svelte-runes adapter over WindowedListCore — the reactive state a component binds to. */
export function createWindowedList<T>(options: WindowedListOptions<T>): WindowedList<T> {
	let items = $state<T[]>([]);
	let offset = $state(0);
	let total = $state(0);
	let loading = $state(false);
	let loaded = $state(false);

	const core = new WindowedListCore<T>(options, (s) => {
		items = s.items;
		offset = s.offset;
		total = s.total;
		loading = s.loading;
		loaded = s.loaded;
	});

	return {
		get items() { return items; },
		get offset() { return offset; },
		get total() { return total; },
		get loading() { return loading; },
		get loaded() { return loaded; },
		shiftTo: (targetStart: number) => { void core.shiftTo(targetStart); },
		reset: () => { void core.reset(); },
		clear: () => core.clear()
	};
}
