CREATE TABLE "container_start_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"environment_id" integer,
	"container_name" text NOT NULL,
	"enabled" boolean DEFAULT false,
	"schedule_type" text DEFAULT 'daily',
	"cron_expression" text,
	"last_started" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "container_start_schedules_environment_id_container_name_unique" UNIQUE("environment_id","container_name")
);
--> statement-breakpoint
ALTER TABLE "stack_sources" RENAME COLUMN "external_compose_path" TO "compose_path";--> statement-breakpoint
ALTER TABLE "stack_sources" RENAME COLUMN "external_env_path" TO "env_path";--> statement-breakpoint
ALTER TABLE "git_repositories" ALTER COLUMN "compose_path" SET DEFAULT 'compose.yaml';--> statement-breakpoint
ALTER TABLE "git_stacks" ALTER COLUMN "compose_path" SET DEFAULT 'compose.yaml';--> statement-breakpoint
ALTER TABLE "container_start_schedules" ADD CONSTRAINT "container_start_schedules_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;