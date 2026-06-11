# Integrating Upstream Database Migrations

This fork has its own migration history. Do not copy or merge a new upstream
`drizzle/` or `drizzle-pg/` directory over it unchanged.

Drizzle Kit generates a migration by comparing the current TypeScript schema
with the latest snapshot in the selected migration directory. At runtime,
Drizzle decides whether to run migrations using the `when` timestamps in
`meta/_journal.json`. A conflicting migration number or an older timestamp can
therefore cause a migration to be skipped or applied in the wrong order.

## Current Fork Baseline

- SQLite migrations are in `drizzle/`.
- PostgreSQL migrations are in `drizzle-pg/`.
- `drizzle.config.ts` selects the dialect from `DATABASE_URL`.
- The fork's SQLite migration `0007_simple_unicorn` creates
  `container_start_schedules`.
- The PostgreSQL journal currently ends at `0006`. Any PostgreSQL migration
  generated from the current branch must be reviewed carefully because it may
  include both the fork's schema changes and new upstream changes.
- The application automatically applies pending migrations during startup.

Treat committed SQL files, snapshots, and journal entries as immutable after
they have been deployed.

## Update Procedure

### 1. Back Up Everything

Before editing migration history:

1. Back up every deployed SQLite database.
2. Take a PostgreSQL backup if PostgreSQL is used.
3. Create an integration branch from `mine`.

```bash
git switch mine
git pull --ff-only origin mine
git fetch upstream
git switch -c integrate-upstream-<version>
```

Do not test a migration for the first time against the production database.

### 2. Inspect the Upstream Changes

List upstream changes since the current branch diverged:

```bash
git diff --name-status mine...upstream/main
git diff mine...upstream/main -- \
  src/lib/server/db/schema \
  drizzle \
  drizzle-pg
```

Read the upstream SQL and identify:

- schema changes;
- data migrations or backfills;
- destructive statements;
- renamed tables or columns;
- migration numbers that conflict with the fork.

If an upstream migration contains data transformation SQL, save that logic.
Drizzle Kit can regenerate schema changes, but it cannot infer a data backfill.

### 3. Merge Upstream Code Without Replacing Fork History

Merge upstream:

```bash
git merge upstream/main
```

Resolve application and TypeScript schema conflicts normally. The final schema
files must contain both the fork's changes and the upstream changes:

- `src/lib/server/db/schema/index.ts`
- `src/lib/server/db/schema/pg-schema.ts`

For conflicts under `drizzle/` and `drizzle-pg/`, preserve the migration
directories from the integration branch as the baseline. Do not retain an
upstream migration under a number already used by the fork.

```bash
git restore --source=HEAD --staged --worktree -- drizzle drizzle-pg
```

During an unresolved merge, `HEAD` is the integration branch's pre-merge
commit. This command is correct only while merging upstream into a branch
created from `mine`. It also removes upstream-only migration files that Git may
have merged without reporting a conflict. Check `git status` before running it.

### 4. Generate the SQLite Migration

With `DATABASE_URL` unset, the config selects SQLite:

```bash
env -u DATABASE_URL npx drizzle-kit generate \
  --name=upstream_<version>_sqlite
```

Drizzle Kit should compare the merged SQLite schema against the fork's latest
snapshot and create the next migration after `0007_simple_unicorn`.

Review all generated files:

```bash
git diff -- drizzle
```

Confirm that:

- the new journal entry has the next `idx`;
- its `when` value is greater than the previous entry;
- the SQL contains only the expected upstream schema changes;
- it does not recreate `container_start_schedules`;
- it does not drop fork-owned columns, tables, indexes, or constraints.

Add any required upstream data backfill SQL to the generated SQL file. Preserve
Drizzle's `--> statement-breakpoint` separators where separate statements are
required.

### 5. Generate the PostgreSQL Migration

Use a disposable PostgreSQL URL so the config selects PostgreSQL. The
`generate` command reads schema files and snapshots; it must not target
production.

```bash
DATABASE_URL='postgresql://user:password@localhost:5432/dockhand_migration_test' \
  npx drizzle-kit generate --name=upstream_<version>_postgres
```

Review all generated files:

```bash
git diff -- drizzle-pg
```

Because the current PostgreSQL journal ends at `0006`, verify whether the SQL
also creates `container_start_schedules`. That is expected for an existing
fork PostgreSQL database that has never received a migration for that table.
Do not remove it unless every supported PostgreSQL database already has the
table and its migration record is known to be correct.

Apply any PostgreSQL-specific form of upstream data backfills to this generated
SQL file.

### 6. Validate the Migration Chain

Check the generated journals:

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

### 7. Test Both Upgrade Paths

Test against disposable copies, never the originals.

For each supported dialect, test:

1. A copy of a database last used by `mine`.
2. A new empty database.
3. Application startup once to apply migrations.
4. Application startup a second time to confirm migrations are idempotent.
5. The database health endpoint and affected application behavior.

Use the targeted database tests where applicable:

```bash
bun test tests/database-postgres.test.ts
bun test tests/crud-operations.test.ts
```

The expected result is:

- the first startup applies only new migrations;
- the second startup reports no pending migrations;
- no `already exists`, missing column, or duplicate constraint errors occur;
- existing data remains intact.

### 8. Commit the Integration

Commit the merged schemas, regenerated migrations, snapshots, journals, and any
required data backfills together:

```bash
git status
git diff --check
git add src/lib/server/db/schema drizzle drizzle-pg
git commit
```

Review any other merged files before committing them. Do not blindly stage the
entire working tree.

## Never Do These

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

## Why Regeneration Is Required

The upstream migration was generated from upstream's latest snapshot. This
fork's latest snapshot is different. Keeping the fork's snapshots and
generating a fresh migration makes Drizzle calculate:

```text
fork schema + upstream schema changes = merged schema
```

That preserves the deployed fork history while translating upstream's schema
change into the fork's next valid migration.

Official references:

- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate)
