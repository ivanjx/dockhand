CREATE TABLE `container_start_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`environment_id` integer,
	`container_name` text NOT NULL,
	`enabled` integer DEFAULT false,
	`schedule_type` text DEFAULT 'daily',
	`cron_expression` text,
	`last_started` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `container_start_schedules_environment_id_container_name_unique` ON `container_start_schedules` (`environment_id`,`container_name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_git_repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`branch` text DEFAULT 'main',
	`credential_id` integer,
	`compose_path` text DEFAULT 'compose.yaml',
	`environment_id` integer,
	`auto_update` integer DEFAULT false,
	`auto_update_schedule` text DEFAULT 'daily',
	`auto_update_cron` text DEFAULT '0 3 * * *',
	`webhook_enabled` integer DEFAULT false,
	`webhook_secret` text,
	`last_sync` text,
	`last_commit` text,
	`sync_status` text DEFAULT 'pending',
	`sync_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`credential_id`) REFERENCES `git_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_git_repositories`("id", "name", "url", "branch", "credential_id", "compose_path", "environment_id", "auto_update", "auto_update_schedule", "auto_update_cron", "webhook_enabled", "webhook_secret", "last_sync", "last_commit", "sync_status", "sync_error", "created_at", "updated_at") SELECT "id", "name", "url", "branch", "credential_id", "compose_path", "environment_id", "auto_update", "auto_update_schedule", "auto_update_cron", "webhook_enabled", "webhook_secret", "last_sync", "last_commit", "sync_status", "sync_error", "created_at", "updated_at" FROM `git_repositories`;--> statement-breakpoint
DROP TABLE `git_repositories`;--> statement-breakpoint
ALTER TABLE `__new_git_repositories` RENAME TO `git_repositories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `git_repositories_name_unique` ON `git_repositories` (`name`);--> statement-breakpoint
CREATE TABLE `__new_git_stacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stack_name` text NOT NULL,
	`environment_id` integer,
	`repository_id` integer NOT NULL,
	`compose_path` text DEFAULT 'compose.yaml',
	`env_file_path` text,
	`auto_update` integer DEFAULT false,
	`auto_update_schedule` text DEFAULT 'daily',
	`auto_update_cron` text DEFAULT '0 3 * * *',
	`webhook_enabled` integer DEFAULT false,
	`webhook_secret` text,
	`last_sync` text,
	`last_commit` text,
	`sync_status` text DEFAULT 'pending',
	`sync_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `git_repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_git_stacks`("id", "stack_name", "environment_id", "repository_id", "compose_path", "env_file_path", "auto_update", "auto_update_schedule", "auto_update_cron", "webhook_enabled", "webhook_secret", "last_sync", "last_commit", "sync_status", "sync_error", "created_at", "updated_at") SELECT "id", "stack_name", "environment_id", "repository_id", "compose_path", "env_file_path", "auto_update", "auto_update_schedule", "auto_update_cron", "webhook_enabled", "webhook_secret", "last_sync", "last_commit", "sync_status", "sync_error", "created_at", "updated_at" FROM `git_stacks`;--> statement-breakpoint
DROP TABLE `git_stacks`;--> statement-breakpoint
ALTER TABLE `__new_git_stacks` RENAME TO `git_stacks`;--> statement-breakpoint
CREATE UNIQUE INDEX `git_stacks_stack_name_environment_id_unique` ON `git_stacks` (`stack_name`,`environment_id`);