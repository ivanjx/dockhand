ALTER TABLE `git_stacks` ADD `build_on_deploy` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `git_stacks` ADD `repull_images` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `git_stacks` ADD `force_redeploy` integer DEFAULT false;