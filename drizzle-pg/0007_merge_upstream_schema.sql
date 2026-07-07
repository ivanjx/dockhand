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
ALTER TABLE "container_start_schedules" ADD CONSTRAINT "container_start_schedules_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "git_stacks" ADD COLUMN "synced_files" text;
--> statement-breakpoint
CREATE TABLE "template_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"builtin" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "template_sources_source_id_unique" UNIQUE("source_id")
);
