CREATE TABLE `container_icon_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`container_name` text NOT NULL,
	`environment_id` integer,
	`icon` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `container_icon_overrides_container_name_environment_id_unique` ON `container_icon_overrides` (`container_name`,`environment_id`);--> statement-breakpoint
CREATE TABLE `secret_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_providers_name_unique` ON `secret_providers` (`name`);--> statement-breakpoint
ALTER TABLE `backup_destinations` ADD `cacert` text;--> statement-breakpoint
ALTER TABLE `backup_destinations` ADD `tls_client_cert` text;--> statement-breakpoint
ALTER TABLE `git_stacks` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `pending_container_updates` ADD `has_image_update` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_container_updates` ADD `newer_version` text;--> statement-breakpoint
ALTER TABLE `stack_sources` ADD `secret_provider_id` integer REFERENCES secret_providers(id);--> statement-breakpoint
ALTER TABLE `stack_sources` ADD `injected_secret_keys` text;--> statement-breakpoint
ALTER TABLE `stack_sources` ADD `icon` text;