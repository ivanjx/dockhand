CREATE TABLE `container_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`container_name` text NOT NULL,
	`environment_id` integer,
	`tag_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `container_tags_container_name_environment_id_tag_id_unique` ON `container_tags` (`container_name`,`environment_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`webauthn_user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`aaguid` text,
	`name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentials_credential_id_unique` ON `passkey_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkey_credentials_user_id_idx` ON `passkey_credentials` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentials_user_name_unique` ON `passkey_credentials` (`user_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `stack_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stack_name` text NOT NULL,
	`environment_id` integer,
	`tag_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stack_tags_stack_name_environment_id_tag_id_unique` ON `stack_tags` (`stack_name`,`environment_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`icon` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name` COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `pending_container_updates` ADD `release_age_remaining_hours` integer;--> statement-breakpoint
CREATE INDEX `schedule_executions_entity_env_idx` ON `schedule_executions` (`entity_name`,`environment_id`);