<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Search,
		RefreshCw,
		Download,
		FileJson,
		FileSpreadsheet,
		FileText,
		Calendar,
		User,
		Box,
		Layers,
		HardDrive,
		Network,
		Image,
		Settings,
		GitBranch,
		Key,
		Filter,
		X,
		Info,
		Crown,
		Server,
		Database,
		Shield,
		Plus,
		Pencil,
		Trash2,
		Play,
		Square,
		RotateCcw,
		Pause,
		CirclePlay,
		ArrowDownToLine,
		ArrowUpFromLine,
		Scissors,
		Terminal,
		Link,
		Unlink,
		LogIn,
		LogOut,
		GitPullRequest,
		Activity,
		Loader2,
		Wifi,
		FileX
	} from 'lucide-svelte';
	import { licenseStore } from '$lib/stores/license';
	import { currentEnvironment } from '$lib/stores/environment';
	import { getIconComponent } from '$lib/utils/icons';
	import {
		auditSseConnected,
		auditSseError,
		connectAuditSSE,
		disconnectAuditSSE,
		onAuditEvent,
		type AuditLogEntry as SSEAuditLogEntry
	} from '$lib/stores/audit-events';
	import { formatDateTime } from '$lib/stores/settings';
	import PageHeader from '$lib/components/PageHeader.svelte';

	interface AuditLogEntry {
		id: number;
		user_id: number | null;
		username: string;
		action: string;
		entity_type: string;
		entity_id: string | null;
		entity_name: string | null;
		environment_id: number | null;
		environment_name: string | null;
		environment_icon: string | null;
		description: string | null;
		details: any | null;
		ip_address: string | null;
		user_agent: string | null;
		timestamp: string;
	}

	interface Environment {
		id: number;
		name: string;
		icon: string;
	}

	// Constants
	const ROW_HEIGHT = 33; // Height of each row in pixels
	const BUFFER_ROWS = 10; // Extra rows to render above/below viewport
	const FETCH_BATCH_SIZE = 100; // Number of rows to fetch per request
	const SCROLL_THRESHOLD = 200; // Pixels from bottom to trigger fetch

	// State
	let logs = $state<AuditLogEntry[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let loadingMore = $state(false);
	let users = $state<string[]>([]);
	let environments = $state<Environment[]>([]);
	let envId = $state<number | null>(null);
	let hasMore = $state(true);
	let initialized = $state(false); // Track if initial data fetch has started
	let dataFetched = $state(false); // Track if data has been fetched at least once

	// Virtual scroll state
	let scrollContainer = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let containerHeight = $state(600);

	// localStorage key for filters
	const STORAGE_KEY = 'dockhand_audit_filters';

	// Filters - now arrays for multi-select (initialized empty, loaded from localStorage in onMount)
	let filterUsernames = $state<string[]>([]);
	let filterEntityTypes = $state<string[]>([]);
	let filterActions = $state<string[]>([]);
	let filterEnvironmentId = $state<number | null>(null);
	let filterFromDate = $state('');
	let filterToDate = $state('');

	// Load filters from localStorage (called in onMount)
	function loadFiltersFromStorage() {
		if (typeof window === 'undefined') return;
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				filterUsernames = parsed.usernames || [];
				filterEntityTypes = parsed.entityTypes || [];
				filterActions = parsed.actions || [];
				filterEnvironmentId = parsed.environmentId || null;
				filterFromDate = parsed.fromDate || '';
				filterToDate = parsed.toDate || '';
			}
		} catch (e) {
			console.error('Failed to load audit filters from localStorage:', e);
		}
	}

	// Save filters to localStorage when they change
	function saveFiltersToStorage() {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				usernames: filterUsernames,
				entityTypes: filterEntityTypes,
				actions: filterActions,
				environmentId: filterEnvironmentId,
				fromDate: filterFromDate,
				toDate: filterToDate
			}));
		} catch (e) {
			console.error('Failed to save audit filters to localStorage:', e);
		}
	}

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedLog = $state<AuditLogEntry | null>(null);

	// Export dropdown
	let showExportMenu = $state(false);

	const entityTypes = [
		{ value: 'container', label: 'Containers' },
		{ value: 'image', label: 'Images' },
		{ value: 'volume', label: 'Volumes' },
		{ value: 'network', label: 'Networks' },
		{ value: 'stack', label: 'Stacks' },
		{ value: 'environment', label: 'Environments' },
		{ value: 'registry', label: 'Registries' },
		{ value: 'user', label: 'Users' },
		{ value: 'role', label: 'Roles' },
		{ value: 'settings', label: 'Settings' },
		{ value: 'git_repository', label: 'Git repositories' },
		{ value: 'git_credential', label: 'Git credentials' }
	];

	const actionTypes = [
		{ value: 'create', label: 'Create' },
		{ value: 'update', label: 'Update' },
		{ value: 'delete', label: 'Delete' },
		{ value: 'start', label: 'Start' },
		{ value: 'stop', label: 'Stop' },
		{ value: 'restart', label: 'Restart' },
		{ value: 'pause', label: 'Pause' },
		{ value: 'unpause', label: 'Unpause' },
		{ value: 'pull', label: 'Pull' },
		{ value: 'push', label: 'Push' },
		{ value: 'prune', label: 'Prune' },
		{ value: 'exec', label: 'Exec' },
		{ value: 'connect', label: 'Connect' },
		{ value: 'disconnect', label: 'Disconnect' },
		{ value: 'login', label: 'Login' },
		{ value: 'logout', label: 'Logout' },
		{ value: 'sync', label: 'Sync' }
	];

	// Date filter preset
	let selectedDatePreset = $state<string>('');

	const datePresets = [
		{ value: 'today', label: 'Today' },
		{ value: 'yesterday', label: 'Yesterday' },
		{ value: 'last7days', label: 'Last 7 days' },
		{ value: 'last30days', label: 'Last 30 days' },
		{ value: 'thisMonth', label: 'This month' },
		{ value: 'lastMonth', label: 'Last month' }
	];

	function formatDateForInput(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function applyDatePreset(preset: string): { from: string; to: string } {
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		let from = '';
		let to = '';

		switch (preset) {
			case 'today':
				from = formatDateForInput(today);
				to = formatDateForInput(today);
				break;
			case 'yesterday': {
				const yesterday = new Date(today);
				yesterday.setDate(yesterday.getDate() - 1);
				from = formatDateForInput(yesterday);
				to = formatDateForInput(yesterday);
				break;
			}
			case 'last7days': {
				const weekAgo = new Date(today);
				weekAgo.setDate(weekAgo.getDate() - 6);
				from = formatDateForInput(weekAgo);
				to = formatDateForInput(today);
				break;
			}
			case 'last30days': {
				const monthAgo = new Date(today);
				monthAgo.setDate(monthAgo.getDate() - 29);
				from = formatDateForInput(monthAgo);
				to = formatDateForInput(today);
				break;
			}
			case 'thisMonth': {
				const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
				from = formatDateForInput(firstOfMonth);
				to = formatDateForInput(today);
				break;
			}
			case 'lastMonth': {
				const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
				const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
				from = formatDateForInput(firstOfLastMonth);
				to = formatDateForInput(lastOfLastMonth);
				break;
			}
		}

		// Set both dates atomically to avoid triggering effect twice
		filterFromDate = from;
		filterToDate = to;

		return { from, to };
	}

	// Subscribe to environment
	$effect(() => {
		const env = $currentEnvironment;
		envId = env?.id ?? null;
	});

	// Virtual scroll calculations
	const totalHeight = $derived(logs.length * ROW_HEIGHT);
	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS));
	const endIndex = $derived(Math.min(logs.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS));
	const visibleLogs = $derived(logs.slice(startIndex, endIndex));
	const offsetY = $derived(startIndex * ROW_HEIGHT);

	// Visible range for display (without buffer)
	const visibleStart = $derived(Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) + 1));
	const visibleEnd = $derived(Math.max(1, Math.min(logs.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT))));

	let refreshing = $state(false); // For silent background refreshes

	// AbortController for canceling pending fetch requests
	let fetchController: AbortController | null = null;

	async function fetchLogs(append = false, silent = false) {
		if (!$licenseStore.isEnterprise) return;

		// For append/loadMore, don't allow concurrent requests
		if (append && loadingMore) return;

		// Cancel any pending request when starting a new filter request
		if (!append && fetchController) {
			fetchController.abort();
		}

		if (append) {
			loadingMore = true;
		} else if (silent) {
			// Silent refresh - don't show spinner or clear logs
			refreshing = true;
		} else {
			// Full refresh - show loading spinner but DON'T clear logs yet
			// (they'll be replaced when new data arrives)
			loading = true;
			hasMore = true;
			// Reset scroll position when fetching fresh
			if (scrollContainer) {
				scrollContainer.scrollTop = 0;
			}
			scrollTop = 0;
		}

		// Create new abort controller for this request
		fetchController = new AbortController();

		try {
			const params = new URLSearchParams();

			// Multi-select filters - join with comma
			if (filterUsernames.length > 0) params.set('usernames', filterUsernames.join(','));
			if (filterEntityTypes.length > 0) params.set('entity_types', filterEntityTypes.join(','));
			if (filterActions.length > 0) params.set('actions', filterActions.join(','));
			if (filterEnvironmentId !== null) params.set('environment_id', String(filterEnvironmentId));
			if (filterFromDate) params.set('from_date', filterFromDate);
			if (filterToDate) params.set('to_date', filterToDate + 'T23:59:59');
			params.set('limit', String(FETCH_BATCH_SIZE));
			params.set('offset', String(append ? logs.length : 0));

			const response = await fetch(`/api/audit?${params.toString()}`, {
				signal: fetchController.signal
			});
			if (!response.ok) {
				throw new Error('Failed to fetch audit logs');
			}
			const data = await response.json();

			if (append) {
				logs = [...logs, ...data.logs];
			} else {
				logs = data.logs;
			}
			total = data.total;
			hasMore = logs.length < total;
			dataFetched = true;

			// Reset loading state on success
			loading = false;
			loadingMore = false;
			refreshing = false;
			fetchController = null;
		} catch (error: any) {
			// Ignore abort errors (expected when canceling requests)
			// Don't reset loading state since a new request is in flight
			if (error?.name === 'AbortError') {
				// Note: loading state will be managed by the new request
				return;
			}
			console.error('Failed to fetch audit logs:', error);
			if (!append && !silent) {
				logs = [];
				total = 0;
			}
			// Reset loading state on error (but not abort)
			loading = false;
			loadingMore = false;
			refreshing = false;
			fetchController = null;
			hasMore = false;
		}
	}

	async function fetchUsers() {
		if (!$licenseStore.isEnterprise) return;

		try {
			const response = await fetch('/api/audit/users');
			if (response.ok) {
				users = await response.json();
			}
		} catch (error) {
			console.error('Failed to fetch users:', error);
		}
	}

	async function fetchEnvironments() {
		try {
			const response = await fetch('/api/environments');
			if (response.ok) {
				environments = await response.json();
			}
		} catch (error) {
			console.error('Failed to fetch environments:', error);
		}
	}

	function clearFilters() {
		filterUsernames = [];
		filterEntityTypes = [];
		filterEnvironmentId = null;
		filterActions = [];
		filterFromDate = '';
		filterToDate = '';
		selectedDatePreset = '';
		// Clear localStorage as well
		if (typeof window !== 'undefined') {
			localStorage.removeItem(STORAGE_KEY);
		}
	}

	// Track if initial load is done
	let initialLoadDone = $state(false);

	// Auto-fetch when filters change and save to localStorage
	$effect(() => {
		// Access all filter values to track them
		const _u = filterUsernames;
		const _e = filterEntityTypes;
		const _a = filterActions;
		const _fd = filterFromDate;
		const _td = filterToDate;

		// Use untrack for initialLoadDone to prevent this effect from running
		// when initialLoadDone changes (which would cause a double-fetch)
		const isReady = untrack(() => initialLoadDone);
		const isEnterprise = untrack(() => $licenseStore.isEnterprise);

		// Only auto-fetch after initial load
		if (isReady && isEnterprise) {
			saveFiltersToStorage();
			fetchLogs(false);
		}
	});

	function handleScroll(event: Event) {
		const target = event.target as HTMLDivElement;
		scrollTop = target.scrollTop;

		// Check if we need to load more
		const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
		if (scrollBottom < SCROLL_THRESHOLD && hasMore && !loadingMore && !loading) {
			fetchLogs(true);
		}
	}

	function showDetails(log: AuditLogEntry) {
		selectedLog = log;
		showDetailDialog = true;
	}

	async function exportLogs(format: string) {
		showExportMenu = false;
		const params = new URLSearchParams();

		if (filterUsernames.length > 0) params.set('usernames', filterUsernames.join(','));
		if (filterEntityTypes.length > 0) params.set('entity_types', filterEntityTypes.join(','));
		if (filterActions.length > 0) params.set('actions', filterActions.join(','));
		if (filterFromDate) params.set('from_date', filterFromDate);
		if (filterToDate) params.set('to_date', filterToDate + 'T23:59:59');
		params.set('format', format);

		window.location.href = `/api/audit/export?${params.toString()}`;
	}

	function formatTimestamp(ts: string): string {
		return formatDateTime(ts, true);
	}

	function getEntityIcon(entityType: string) {
		switch (entityType) {
			case 'container': return Box;
			case 'image': return Image;
			case 'volume': return HardDrive;
			case 'network': return Network;
			case 'stack': return Layers;
			case 'user': return User;
			case 'role': return Shield;
			case 'settings': return Settings;
			case 'environment': return Server;
			case 'registry': return Database;
			case 'git_repository': return GitBranch;
			case 'git_credential': return Key;
			default: return Box;
		}
	}

	function getActionIcon(action: string) {
		switch (action) {
			case 'create': return Plus;
			case 'update': return Pencil;
			case 'delete': return Trash2;
			case 'start': return Play;
			case 'stop': return Square;
			case 'restart': return RotateCcw;
			case 'pause': return Pause;
			case 'unpause': return CirclePlay;
			case 'pull': return ArrowDownToLine;
			case 'push': return ArrowUpFromLine;
			case 'prune': return Scissors;
			case 'exec': return Terminal;
			case 'connect': return Link;
			case 'disconnect': return Unlink;
			case 'login': return LogIn;
			case 'logout': return LogOut;
			case 'sync': return GitPullRequest;
			default: return Activity;
		}
	}

	function getActionColor(action: string): string {
		switch (action) {
			case 'create':
			case 'start':
			case 'login':
				return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
			case 'delete':
			case 'stop':
			case 'logout':
				return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
			case 'update':
			case 'restart':
				return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
			case 'pull':
			case 'push':
			case 'sync':
				return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
			case 'exec':
			case 'connect':
			case 'disconnect':
				return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400';
			default:
				return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
		}
	}

	// SSE event listener cleanup function
	let unsubscribeSSE: (() => void) | null = null;

	// Handle new audit events from SSE
	function handleNewAuditEvent(event: SSEAuditLogEntry) {
		// Check if event matches current filters
		if (filterUsernames.length > 0 && !filterUsernames.includes(event.username)) return;
		if (filterEntityTypes.length > 0 && !filterEntityTypes.includes(event.entity_type)) return;
		if (filterActions.length > 0 && !filterActions.includes(event.action)) return;

		// Check date filters
		if (filterFromDate) {
			const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
			if (eventDate < filterFromDate) return;
		}
		if (filterToDate) {
			const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
			if (eventDate > filterToDate) return;
		}

		// Add to beginning of logs (prepend new events)
		// Check if already exists (avoid duplicates)
		if (!logs.some(log => log.id === event.id)) {
			logs = [event as AuditLogEntry, ...logs];
			total = total + 1;

			// Add user to list if not already there
			if (!users.includes(event.username)) {
				users = [...users, event.username].sort();
			}
		}
	}

	// Resize handler - stored at module scope for cleanup in onDestroy
	let resizeHandler: (() => void) | null = null;

	onMount(async () => {
		// Load saved filters from localStorage first
		loadFiltersFromStorage();

		// Fetch environments list (needed for filter dropdown, regardless of license)
		await fetchEnvironments();

		// Wait for license store to finish loading
		const licenseState = await licenseStore.waitUntilLoaded();

		// Fetch data if enterprise license is active
		if (licenseState.isEnterprise) {
			initialized = true; // Mark as initialized before fetching
			await fetchLogs();
			await fetchUsers();

			// Connect to SSE for real-time updates
			connectAuditSSE();
			unsubscribeSSE = onAuditEvent(handleNewAuditEvent);
		} else {
			initialized = true; // Also mark as initialized if not enterprise
		}

		// Mark initial load done AFTER fetching so the auto-fetch effect doesn't interfere
		initialLoadDone = true;

		// Update container height on resize
		resizeHandler = () => {
			if (scrollContainer) {
				containerHeight = scrollContainer.clientHeight;
			}
		};

		resizeHandler();
		window.addEventListener('resize', resizeHandler);
		// Note: In Svelte 5, cleanup must be in onDestroy, not returned from onMount
	});

	onDestroy(() => {
		if (resizeHandler) {
			window.removeEventListener('resize', resizeHandler);
			resizeHandler = null;
		}
		// Disconnect SSE when component unmounts
		disconnectAuditSSE();
		if (unsubscribeSSE) {
			unsubscribeSSE();
			unsubscribeSSE = null;
		}
	});

	// Refetch when license changes (only after initial mount)
	$effect(() => {
		const isEnterprise = $licenseStore.isEnterprise;
		// Use untrack to prevent loop - we only want to react to license changes
		const fetched = untrack(() => dataFetched);
		const ready = untrack(() => initialLoadDone);
		const isLoading = untrack(() => loading);

		if (isEnterprise && !fetched && ready && !isLoading) {
			fetchLogs();
			fetchUsers();
		}
	});

	// Update container height when scrollContainer changes
	$effect(() => {
		if (scrollContainer) {
			containerHeight = scrollContainer.clientHeight;
		}
	});
</script>

<svelte:head>
	<title>Audit log - Dockhand</title>
</svelte:head>

<div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
	<!-- Header -->
	<div class="flex items-center justify-between shrink-0">
		<PageHeader icon={Crown} title="Audit log" iconClass="text-amber-500">
			{#if $licenseStore.isEnterprise && total > 0}
				<span class="text-xs text-muted-foreground tabular-nums">
					Showing {visibleStart}-{visibleEnd} of {total}
				</span>
			{/if}
		</PageHeader>
			{#if $licenseStore.isEnterprise}
				<div class="flex items-center gap-3">
					<!-- Live indicator -->
					<span
						class="flex items-center gap-1.5 text-xs {$auditSseConnected ? 'text-emerald-500' : 'text-muted-foreground'}"
						title={$auditSseConnected ? 'Live updates active' : 'Connecting...'}
					>
						<Wifi class="w-3.5 h-3.5" />
						<span>{$auditSseConnected ? 'Live' : 'Connecting'}</span>
					</span>
					<Button variant="outline" size="sm" onclick={() => { hasMore = true; fetchLogs(false); }} disabled={loading}>
						<RefreshCw class="w-4 h-4 mr-2 {loading ? 'animate-spin' : ''}" />
						Refresh
					</Button>
					<div class="relative">
						<Button variant="outline" size="sm" onclick={() => showExportMenu = !showExportMenu}>
							<Download class="w-4 h-4 mr-2" />
							Export
						</Button>
						{#if showExportMenu}
							<div class="absolute right-0 mt-1 w-40 bg-popover border rounded-md shadow-lg z-50">
								<button
									type="button"
									class="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent"
									onclick={() => exportLogs('json')}
								>
									<FileJson class="w-4 h-4" />
									JSON
								</button>
								<button
									type="button"
									class="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent"
									onclick={() => exportLogs('csv')}
								>
									<FileSpreadsheet class="w-4 h-4" />
									CSV
								</button>
								<button
									type="button"
									class="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent"
									onclick={() => exportLogs('md')}
								>
									<FileText class="w-4 h-4" />
									Markdown
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		{#if $licenseStore.loading}
			<!-- Loading license status -->
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<Loader2 class="w-8 h-8 animate-spin text-muted-foreground mb-4" />
				<p class="text-muted-foreground">Loading...</p>
			</div>
		{:else if !$licenseStore.isEnterprise}
			<!-- Enterprise feature notice -->
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<div class="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
					<Crown class="w-8 h-8 text-amber-500" />
				</div>
				<h2 class="text-xl font-semibold mb-2">Enterprise feature</h2>
				<p class="text-muted-foreground max-w-md mb-6">
					Audit logging is an enterprise feature that tracks all user actions for compliance and security monitoring.
				</p>
				<Button variant="outline" href="/settings?tab=license">
					<Key class="w-4 h-4 mr-2" />
					Activate license
				</Button>
			</div>
		{:else}
			<!-- Filters -->
			<div class="bg-card border rounded-lg p-4 shrink-0">
				<div class="flex flex-wrap items-center gap-3">
					<div class="flex items-center gap-2 shrink-0">
						<Filter class="w-4 h-4 text-muted-foreground" />
						<span class="text-sm font-medium">Filters</span>
					</div>
					<!-- User filter (multi-select) -->
					<Select.Root type="multiple" bind:value={filterUsernames}>
						<Select.Trigger class="w-40">
							<User class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
							<span class="truncate">
								{#if filterUsernames.length === 0}
									All users
								{:else if filterUsernames.length === 1}
									{filterUsernames[0]}
								{:else}
									{filterUsernames.length} users
								{/if}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#if filterUsernames.length > 0}
								<button
									type="button"
									class="w-full px-2 py-1 text-xs text-left text-muted-foreground/60 hover:text-muted-foreground"
									onclick={() => filterUsernames = []}
								>
									Clear
								</button>
							{/if}
							{#each users as user}
								<Select.Item value={user}>
									<User class="w-4 h-4 mr-2 text-muted-foreground" />
									{user}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					<!-- Entity type filter (multi-select) -->
					<Select.Root type="multiple" bind:value={filterEntityTypes}>
						<Select.Trigger class="w-40">
							<Box class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
							<span class="truncate">
								{#if filterEntityTypes.length === 0}
									All entities
								{:else if filterEntityTypes.length === 1}
									{entityTypes.find(e => e.value === filterEntityTypes[0])?.label || filterEntityTypes[0]}
								{:else}
									{filterEntityTypes.length} entities
								{/if}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#if filterEntityTypes.length > 0}
								<button
									type="button"
									class="w-full px-2 py-1 text-xs text-left text-muted-foreground/60 hover:text-muted-foreground"
									onclick={() => filterEntityTypes = []}
								>
									Clear
								</button>
							{/if}
							{#each entityTypes as type}
								<Select.Item value={type.value}>
									<svelte:component this={getEntityIcon(type.value)} class="w-4 h-4 mr-2 text-muted-foreground" />
									{type.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					<!-- Action filter (multi-select) -->
					<Select.Root type="multiple" bind:value={filterActions}>
						<Select.Trigger class="w-40">
							<Activity class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
							<span class="truncate">
								{#if filterActions.length === 0}
									All actions
								{:else if filterActions.length === 1}
									{actionTypes.find(a => a.value === filterActions[0])?.label || filterActions[0]}
								{:else}
									{filterActions.length} actions
								{/if}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#if filterActions.length > 0}
								<button
									type="button"
									class="w-full px-2 py-1 text-xs text-left text-muted-foreground/60 hover:text-muted-foreground"
									onclick={() => filterActions = []}
								>
									Clear
								</button>
							{/if}
							{#each actionTypes as action}
								<Select.Item value={action.value}>
									<svelte:component this={getActionIcon(action.value)} class="w-4 h-4 mr-2 text-muted-foreground" />
									{action.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					<!-- Environment filter -->
					{#if environments.length > 0}
						{@const selectedEnv = environments.find(e => e.id === filterEnvironmentId)}
						{@const SelectedEnvIcon = selectedEnv ? getIconComponent(selectedEnv.icon || 'globe') : Server}
						<Select.Root
							type="single"
							value={filterEnvironmentId !== null ? String(filterEnvironmentId) : undefined}
							onValueChange={(v) => filterEnvironmentId = v ? parseInt(v) : null}
						>
							<Select.Trigger class="w-48">
								<SelectedEnvIcon class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
								<span class="truncate">
									{#if filterEnvironmentId === null}
										All environments
									{:else}
										{selectedEnv?.name || 'Environment'}
									{/if}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="">
									<Server class="w-4 h-4 mr-2 text-muted-foreground" />
									All environments
								</Select.Item>
								{#each environments as env}
									{@const EnvIcon = getIconComponent(env.icon || 'globe')}
									<Select.Item value={String(env.id)}>
										<EnvIcon class="w-4 h-4 mr-2 text-muted-foreground" />
										{env.name}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}

					<!-- Date range filter -->
					<Select.Root
						type="single"
						value={selectedDatePreset}
						onValueChange={(v) => {
							selectedDatePreset = v || '';
							if (v !== 'custom') {
								applyDatePreset(v || '');
							}
						}}
					>
						<Select.Trigger class="w-40">
							<Calendar class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
							<span class="truncate">
								{#if selectedDatePreset === 'custom'}
									Custom
								{:else if selectedDatePreset}
									{datePresets.find(d => d.value === selectedDatePreset)?.label || 'All time'}
								{:else}
									All time
								{/if}
							</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">All time</Select.Item>
							{#each datePresets as preset}
								<Select.Item value={preset.value}>{preset.label}</Select.Item>
							{/each}
							<Select.Item value="custom">Custom range...</Select.Item>
						</Select.Content>
					</Select.Root>

					<!-- Custom date inputs (shown when "Custom" is selected) -->
					{#if selectedDatePreset === 'custom'}
						<DatePicker bind:value={filterFromDate} placeholder="From" />
						<DatePicker bind:value={filterToDate} placeholder="To" />
					{/if}

					<!-- Clear all button -->
					{#if filterUsernames.length > 0 || filterEntityTypes.length > 0 || filterActions.length > 0 || filterEnvironmentId !== null || selectedDatePreset}
						<Button variant="ghost" size="sm" class="h-8 px-2 text-xs" onclick={clearFilters}>
							<X class="w-3 h-3 mr-1" />
							Clear all
						</Button>
					{/if}
				</div>
			</div>

			<!-- Virtual Scroll Table -->
			<div class="border rounded-lg overflow-hidden flex-1 flex flex-col min-h-0">
				<!-- Fixed Header -->
				<div class="bg-muted/50 border-b shrink-0">
					<!-- Column headers -->
					<div class="grid grid-cols-[185px_100px_120px_50px_120px_1fr_100px_50px] text-sm font-medium text-muted-foreground data-grid">
						<div class="py-2 px-2 whitespace-nowrap">Timestamp</div>
						<div class="py-2 px-2">Environment</div>
						<div class="py-2 px-2">User</div>
						<div class="py-2 px-2">Action</div>
						<div class="py-2 px-2">Entity</div>
						<div class="py-2 px-2">Name</div>
						<div class="py-2 px-2">IP address</div>
						<div class="py-2 px-2"></div>
					</div>
				</div>

				<!-- Scrollable Body with Virtual Scroll -->
				<div
					bind:this={scrollContainer}
					class="flex-1 overflow-auto"
					onscroll={handleScroll}
				>
					{#if loading || !initialized}
						<div class="flex items-center justify-center py-16 text-muted-foreground">
							<RefreshCw class="w-5 h-5 animate-spin mr-2" />
							Loading...
						</div>
					{:else if logs.length === 0}
						<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
							<FileX class="w-10 h-10 mb-3 opacity-40" />
							<p>No audit log entries found</p>
						</div>
					{:else}
						<!-- Virtual scroll container -->
						<div style="height: {totalHeight}px; position: relative;">
							<div style="transform: translateY({offsetY}px);">
								{#each visibleLogs as log (log.id)}
									<div
										class="grid grid-cols-[185px_100px_120px_50px_120px_1fr_100px_50px] items-center border-b hover:bg-muted/50 cursor-pointer data-grid"
										style="height: {ROW_HEIGHT}px;"
										onclick={() => showDetails(log)}
										role="button"
										tabindex="0"
										onkeydown={(e) => e.key === 'Enter' && showDetails(log)}
									>
										<div class="px-2 font-mono whitespace-nowrap">
											{formatTimestamp(log.timestamp)}
										</div>
										<div class="px-2">
											{#if log.environment_name}
												{@const LogEnvIcon = getIconComponent(log.environment_icon || 'globe')}
												<div class="flex items-center gap-1 truncate">
													<LogEnvIcon class="w-3 h-3 text-muted-foreground shrink-0" />
													<span class="truncate">{log.environment_name}</span>
												</div>
											{:else}
												<span class="text-muted-foreground">-</span>
											{/if}
										</div>
										<div class="px-2">
											<div class="flex items-center gap-1 truncate">
												<User class="w-3 h-3 text-muted-foreground shrink-0" />
												<span class="truncate">{log.username}</span>
											</div>
										</div>
										<div class="px-2" title={log.action.charAt(0).toUpperCase() + log.action.slice(1)}>
											<Badge class={getActionColor(log.action)}>
												<svelte:component this={getActionIcon(log.action)} class="w-3.5 h-3.5" />
											</Badge>
										</div>
										<div class="px-2">
											<div class="flex items-center gap-1 truncate">
												<svelte:component this={getEntityIcon(log.entity_type)} class="w-3 h-3 text-muted-foreground shrink-0" />
												<span class="truncate">{log.entity_type}</span>
											</div>
										</div>
										<div class="px-2">
											<span class="truncate" title={log.entity_name || log.entity_id || '-'}>
												{log.entity_name || log.entity_id || '-'}
											</span>
										</div>
										<div class="px-2 font-mono text-muted-foreground">
											{log.ip_address || '-'}
										</div>
										<div class="px-2 flex items-center justify-center">
											<Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); showDetails(log); }}>
												<Info class="w-4 h-4" />
											</Button>
										</div>
									</div>
								{/each}
							</div>
						</div>

						<!-- Loading more indicator -->
						{#if loadingMore}
							<div class="flex items-center justify-center py-4 text-muted-foreground border-t">
								<Loader2 class="w-4 h-4 animate-spin mr-2" />
								Loading more...
							</div>
						{/if}

						<!-- End of results -->
						{#if !hasMore && logs.length > 0}
							<div class="text-center py-4 text-sm text-muted-foreground border-t">
								End of results ({total.toLocaleString()} entries)
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
</div>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Audit log details</Dialog.Title>
		</Dialog.Header>
		{#if selectedLog}
			<div class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="text-sm font-medium text-muted-foreground">Timestamp</label>
						<p class="font-mono text-sm">{formatTimestamp(selectedLog.timestamp)}</p>
					</div>
					<div>
						<label class="text-sm font-medium text-muted-foreground">User</label>
						<p class="flex items-center gap-1">
							<User class="w-4 h-4 text-muted-foreground" />
							{selectedLog.username}
						</p>
					</div>
					<div>
						<label class="text-sm font-medium text-muted-foreground">Action</label>
						<p>
							<Badge class="{getActionColor(selectedLog.action)} gap-1">
								<svelte:component this={getActionIcon(selectedLog.action)} class="w-3 h-3" />
								{selectedLog.action}
							</Badge>
						</p>
					</div>
					<div>
						<label class="text-sm font-medium text-muted-foreground">Entity type</label>
						<p class="flex items-center gap-1">
							<svelte:component this={getEntityIcon(selectedLog.entity_type)} class="w-4 h-4 text-muted-foreground" />
							{selectedLog.entity_type}
						</p>
					</div>
					{#if selectedLog.entity_name}
						<div>
							<label class="text-sm font-medium text-muted-foreground">Entity name</label>
							<p>{selectedLog.entity_name}</p>
						</div>
					{/if}
					{#if selectedLog.entity_id}
						<div>
							<label class="text-sm font-medium text-muted-foreground">Entity ID</label>
							<p class="font-mono text-sm break-all">{selectedLog.entity_id}</p>
						</div>
					{/if}
					{#if selectedLog.environment_id}
						<div>
							<label class="text-sm font-medium text-muted-foreground">Environment ID</label>
							<p>{selectedLog.environment_id}</p>
						</div>
					{/if}
					{#if selectedLog.ip_address}
						<div>
							<label class="text-sm font-medium text-muted-foreground">IP address</label>
							<p class="font-mono text-sm">{selectedLog.ip_address}</p>
						</div>
					{/if}
				</div>

				{#if selectedLog.description}
					<div>
						<label class="text-sm font-medium text-muted-foreground">Description</label>
						<p>{selectedLog.description}</p>
					</div>
				{/if}

				{#if selectedLog.user_agent}
					<div>
						<label class="text-sm font-medium text-muted-foreground">User agent</label>
						<p class="text-xs text-muted-foreground break-all">{selectedLog.user_agent}</p>
					</div>
				{/if}

				{#if selectedLog.details}
					<div>
						<label class="text-sm font-medium text-muted-foreground">Details</label>
						<pre class="mt-1 p-3 bg-muted rounded-md text-xs overflow-auto max-h-[200px]">{JSON.stringify(selectedLog.details, null, 2)}</pre>
					</div>
				{/if}
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => showDetailDialog = false}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Click outside to close export menu -->
{#if showExportMenu}
	<button
		type="button"
		class="fixed inset-0 z-40"
		onclick={() => showExportMenu = false}
		aria-label="Close menu"
	></button>
{/if}
