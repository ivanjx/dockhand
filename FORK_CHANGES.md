# Fork Changes And Merge Guide

This document tracks fork-owned behavior that should be preserved when merging
upstream changes into the fork branch. It is intentionally about ongoing merge
policy and feature ownership, not about one specific merge session.

Use it with a fresh upstream fetch:

```bash
git switch mine
git fetch origin upstream
git diff --name-status main...mine
git diff --name-status mine...upstream/main
```

## General Merge Rules

- Preserve fork-owned features unless there is an explicit replacement.
- Prefer the smallest conflict resolution that keeps both upstream behavior and
  fork behavior.
- Do not blindly accept an entire upstream file when the fork has feature logic
  in the same area.
- Do not blindly accept upstream `drizzle/` or `drizzle-pg/` directories. This
  fork has custom migration history.
- Keep `container_start` in every schedule type switch that handles schedule
  list, stream, delete, toggle, manual run, execution history, and scheduler
  registration.
- Keep the vulnerability scan behavior where scan failures do not block updates
  when vulnerability criteria is `never`.
- Keep cleanup paths that delete or rename container start schedules when
  containers or stacks are deleted, removed, brought down, or renamed.

## Scheduled Container Starts

The fork adds first-class scheduling for starting existing containers. This is
separate from container auto-update schedules.

Behavior to preserve:

- A `container_start` schedule type exists throughout the scheduler and schedule
  APIs.
- A scheduled start looks up the container by name, skips if it is already
  running, starts it if stopped, records schedule execution logs, and updates
  `last_started`.
- Manual run, toggle, delete, stream updates, list display, filters, and
  execution details support `container_start`.
- Create and edit container flows expose scheduled run settings.
- Container rename updates both auto-update and scheduled-start records.
- Container delete, batch remove, stack down, and stack remove unregister and
  delete scheduled-start records.
- Environment access checks apply to `container_start` schedule run, toggle, and
  delete routes.

Key files:

- `src/lib/server/scheduler/tasks/container-start.ts`
- `src/lib/server/scheduler/index.ts`
- `src/lib/server/db.ts`
- `src/lib/server/db/drizzle.ts`
- `src/lib/server/db/schema/index.ts`
- `src/lib/server/db/schema/pg-schema.ts`
- `src/routes/api/container-start/+server.ts`
- `src/routes/api/container-start/[containerName]/+server.ts`
- `src/routes/api/schedules/+server.ts`
- `src/routes/api/schedules/stream/+server.ts`
- `src/routes/api/schedules/[type]/[id]/+server.ts`
- `src/routes/api/schedules/[type]/[id]/run/+server.ts`
- `src/routes/api/schedules/[type]/[id]/toggle/+server.ts`
- `src/routes/containers/ScheduledStartSettings.svelte`
- `src/routes/containers/ContainerSettingsTab.svelte`
- `src/routes/containers/CreateContainerModal.svelte`
- `src/routes/containers/EditContainerModal.svelte`
- `src/routes/schedules/+page.svelte`

## Shell Attach Terminal

The fork adds a shell-terminal attach mode alongside the existing shell
(`exec`) mode. Attach connects to the running container's main process instead
of creating a new Docker exec session.

Behavior to preserve:

- Terminal mode selection supports `exec` (launch a detected shell) and
  `attach` (connect to the container's main process).
- Attach uses Docker's `/containers/<id>/attach` stream with stdin, stdout, and
  stderr enabled. It does not launch a shell and does not require shell or user
  selection.
- Attach is available from the full terminal page and the per-container
  terminal action. The terminal page lists running containers only.
- The terminal WebSocket keeps authentication and environment access checks for
  attach sessions.
- The `containers:exec` permission is required for terminal WebSocket sessions,
  including attach mode.
- Container TTY settings determine whether Docker's multiplexed output frames
  must be decoded. Terminal resize requests use the container resize endpoint.
- Attach works through local sockets, direct TCP/TLS, and Hawser standard
  connections. Hawser Edge remains exec-only and rejects attach sessions.
- Production and Vite development WebSocket handlers implement the same attach
  stream, resize, cleanup, and output behavior.

Key files:

- `server.js`
- `vite.config.ts`
- `src/lib/server/docker.ts`
- `src/lib/types.ts`
- `src/routes/containers/+page.svelte`
- `src/routes/terminal/+page.svelte`
- `src/routes/terminal/Terminal.svelte`
- `src/routes/terminal/TerminalPanel.svelte`

## Container Update Behavior

The fork changes update handling in ways that should survive upstream conflict
resolution.

Behavior to preserve:

- Vulnerability scan failures only fail or block an update when vulnerability
  criteria requires blocking. If criteria is `never`, updates continue.
- Reuse upstream's `resolveBlockDecision()` logic for vulnerability decisions,
  including fresh current-image scans for `more_than_current`. Keep the fork's
  scan-failure handling in the surrounding update flows so `never` continues
  while blocking criteria still fail safely.
- This applies to scheduled container update, environment update check, and
  batch update stream flows.
- Hidden containers are excluded from update checks.
- Podman infra containers are excluded where upstream added that filter.
- Compose-managed containers update through their stack service instead of
  being recreated with raw container settings.
- If a Compose service was stopped before update, the update recreates it
  without starting it.

Key files:

- `src/lib/server/scheduler/tasks/update-utils.ts`
- `src/lib/server/scheduler/tasks/block-decision.ts`
- `src/lib/server/scheduler/tasks/container-update.ts`
- `src/lib/server/scheduler/tasks/env-update-check.ts`
- `src/routes/api/containers/batch-update-stream/+server.ts`
- `src/routes/api/containers/check-updates/+server.ts`

## Stack And Compose Handling

The fork adjusts stack operations to better support Compose workflows.

Behavior to preserve:

- `executeComposeCommand('up', ...)` runs a `create` step first.
- Local Compose `up` does not pass `--force-recreate`.
- `updateStackService` accepts a no-start mode and uses Compose `create` for
  stopped services.
- Hawser treats Compose `create` as a no-op until remote support exists.
- Stack down/remove cleans up auto-update schedules, scheduled-start schedules,
  and pending container updates for affected containers.

Key file:

- `src/lib/server/stacks.ts`

## Container And Batch Cleanup

The fork keeps schedule state in sync with container lifecycle changes.

Behavior to preserve:

- Removing a container deletes its auto-update schedule, scheduled-start
  schedule, and pending update state.
- Batch remove performs the same cleanup.
- Renaming a container renames both auto-update and scheduled-start schedules.

Key files:

- `src/routes/api/containers/[id]/+server.ts`
- `src/routes/api/containers/[id]/rename/+server.ts`
- `src/routes/api/batch/+server.ts`

## Build, Packaging, And Deployment

The fork carries local deployment/build changes.

Behavior to preserve:

- GitHub Actions workflow builds and pushes fork images to GHCR for amd64 and
  arm64.
- Docker build uses a larger Node heap for `npm run build`.
- Docker Compose examples mount the host Docker Compose CLI plugin into the app
  container.
- `.dockerignore` excludes dependency, build, VCS, compose, Dockerfile, and
  markdown files from the image context.
- The fork keeps lockfiles for npm/Bun workflows.
- The `prebuild` dependency license generation script is removed from
  `package.json`.

Key files:

- `.github/workflows/cicd.yml`
- `.dockerignore`
- `.gitignore`
- `Dockerfile`
- `docker-compose.yaml`
- `docker-compose-postgresql.yaml`
- `package.json`
- `package-lock.json`
- `bun.lock`

After merging upstream changes to `package.json`, refresh both supported lockfile
workflows and review the resulting lockfile diff:

```bash
npm i
bun i
git diff -- package-lock.json bun.lock
```

## Database Migration Rules

This fork has its own migration history. Do not copy or merge a new upstream
`drizzle/` or `drizzle-pg/` directory over it unchanged.

Drizzle Kit generates migrations by comparing the current TypeScript schema
with the latest snapshot in the selected migration directory. At runtime,
Drizzle decides whether to run migrations using the `when` timestamps in
`meta/_journal.json`. A conflicting migration number or an older timestamp can
cause a migration to be skipped or applied in the wrong order.

Current migration assumptions:

- SQLite migrations are in `drizzle/`.
- PostgreSQL migrations are in `drizzle-pg/`.
- `drizzle.config.ts` selects the dialect from `DATABASE_URL`.
- The fork owns the `container_start_schedules` table.
- The application automatically applies pending migrations during startup.

Treat committed SQL files, snapshots, and journal entries as immutable after
they have been deployed.

Never do these:

- Do not rename, reorder, edit, or delete a migration already used by a
  deployed database.
- Do not resolve migration conflicts by accepting the complete upstream
  migration directory.
- Do not keep two different migrations with the same sequence number.
- Do not manually lower or reuse a journal `when` timestamp.
- Do not run `drizzle-kit push` against production to bypass migration
  conflicts.
- Do not manually insert migration records unless the schema and SQL-file hash
  have been independently verified.
- Do not deploy without testing an upgrade from a real copy of the fork's
  existing database.

Why regeneration is usually required:

```text
fork schema + upstream schema changes = merged schema
```

The upstream migration was generated from upstream's latest snapshot. This
fork's latest snapshot is different. Keeping the fork's snapshots and
generating a fresh migration makes Drizzle calculate the next valid migration
from the fork's real deployed baseline.

## Database Migration Procedure

Before editing migration history:

1. Back up every deployed SQLite database.
2. Take a PostgreSQL backup if PostgreSQL is used.
3. Create an integration branch from the fork branch.

```bash
git switch mine
git pull --ff-only origin mine
git fetch upstream
git switch -c integrate-upstream-<version>
```

Do not test a migration for the first time against the production database.

Inspect upstream changes:

```bash
git diff --name-status mine...upstream/main
git diff mine...upstream/main -- \
  src/lib/server/db/schema \
  drizzle \
  drizzle-pg
```

Read upstream SQL and identify:

- schema changes;
- data migrations or backfills;
- destructive statements;
- renamed tables or columns;
- migration numbers that conflict with the fork.

If an upstream migration contains data transformation SQL, save that logic.
Drizzle Kit can regenerate schema changes, but it cannot infer a data backfill.

Merge upstream code:

```bash
git merge upstream/main
```

Resolve application and TypeScript schema conflicts normally. The final schema
files must contain both fork changes and upstream changes:

- `src/lib/server/db/schema/index.ts`
- `src/lib/server/db/schema/pg-schema.ts`

For conflicts under `drizzle/` and `drizzle-pg/`, preserve the migration
directories from the integration branch as the baseline. Do not retain an
upstream migration under a number already used by the fork.

During an unresolved merge into an integration branch created from `mine`, this
restores the fork migration baseline:

```bash
git restore --source=HEAD --staged --worktree -- drizzle drizzle-pg
```

Use that command only after checking `git status`. It also removes upstream-only
migration files that Git may have merged without reporting a conflict.

Generate the SQLite migration with `DATABASE_URL` unset:

```bash
env -u DATABASE_URL npx drizzle-kit generate \
  --name=upstream_<version>_sqlite
```

Review all generated SQLite files:

```bash
git diff -- drizzle
```

Confirm that:

- the new journal entry has the next `idx`;
- its `when` value is greater than the previous entry;
- the SQL contains only expected upstream schema changes;
- it does not recreate fork-owned tables;
- it does not drop fork-owned columns, tables, indexes, or constraints.

Add any required upstream data backfill SQL to the generated SQL file. Preserve
Drizzle's `--> statement-breakpoint` separators where separate statements are
required.

Generate the PostgreSQL migration with a disposable PostgreSQL URL so the config
selects PostgreSQL. The `generate` command reads schema files and snapshots; it
must not target production.

```bash
DATABASE_URL='postgresql://user:password@localhost:5432/dockhand_migration_test' \
  npx drizzle-kit generate --name=upstream_<version>_postgres
```

Review all generated PostgreSQL files:

```bash
git diff -- drizzle-pg
```

If the PostgreSQL journal has not yet received a fork-owned table that SQLite
already has, a generated PostgreSQL migration may legitimately include both
fork schema and upstream schema changes. Do not remove fork-owned schema from
PostgreSQL unless every supported PostgreSQL database already has that schema
and its migration record is known to be correct.

Apply any PostgreSQL-specific form of upstream data backfills to the generated
SQL file.

Validate the migration chain:

```bash
tail -40 drizzle/meta/_journal.json
tail -40 drizzle-pg/meta/_journal.json
git diff --check
```

For each dialect, verify:

- journal `idx` values are continuous;
- tags match SQL filenames;
- `when` values strictly increase;
- every journal entry has a SQL file and snapshot;
- old deployed SQL files are unchanged;
- SQLite and PostgreSQL reach equivalent schemas.

Also inspect the complete migration diff:

```bash
git diff mine -- \
  src/lib/server/db/schema \
  drizzle \
  drizzle-pg
```

## Database Upgrade Testing

Test against disposable copies, never originals.

For each supported dialect, test:

1. A copy of a database last used by the fork branch.
2. A new empty database.
3. Application startup once to apply migrations.
4. Application startup a second time to confirm migrations are idempotent.
5. The database health endpoint and affected application behavior.

Use targeted database tests where applicable:

```bash
bun test tests/database-postgres.test.ts
bun test tests/crud-operations.test.ts
```

The expected result is:

- the first startup applies only new migrations;
- the second startup reports no pending migrations;
- no `already exists`, missing column, or duplicate constraint errors occur;
- existing data remains intact.

Commit the merged schemas, regenerated migrations, snapshots, journals, and any
required data backfills together:

```bash
git status
git diff --check
git add src/lib/server/db/schema drizzle drizzle-pg
git commit
```

Review other merged files before committing them. Do not blindly stage the
entire working tree.

## Quick Post-Merge Checks

After resolving an upstream merge, run at least:

```bash
git diff --name-status main...mine
git diff --check
rg -n "^(<{7}|={7}$|>{7})" .
```

Then check schedule-sensitive and update-sensitive files:

```bash
rg -n "container_start|scheduledStart|ContainerStart" src drizzle drizzle-pg
rg -n "shouldProceedOnScanError|isHiddenByLabel|isPodmanInfraContainer" src/lib/server src/routes/api
```

When TypeScript tooling is available, run the normal project diagnostic command
or at least verify touched schedule routes and scheduler files with `tsc`.

Useful references:

- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate)
