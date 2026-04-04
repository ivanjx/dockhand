ALTER TABLE "git_stacks" ADD COLUMN "build_on_deploy" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "git_stacks" ADD COLUMN "repull_images" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "git_stacks" ADD COLUMN "force_redeploy" boolean DEFAULT false;