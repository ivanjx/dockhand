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
CREATE UNIQUE INDEX `container_start_schedules_environment_id_container_name_unique` ON `container_start_schedules` (`environment_id`,`container_name`);