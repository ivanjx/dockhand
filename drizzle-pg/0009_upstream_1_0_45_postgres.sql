CREATE TABLE "container_icon_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"container_name" text NOT NULL,
	"environment_id" integer,
	"icon" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "container_icon_overrides_container_name_environment_id_unique" UNIQUE("container_name","environment_id")
);
--> statement-breakpoint
CREATE TABLE "secret_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "secret_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "cacert" text;--> statement-breakpoint
ALTER TABLE "backup_destinations" ADD COLUMN "tls_client_cert" text;--> statement-breakpoint
ALTER TABLE "git_stacks" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "pending_container_updates" ADD COLUMN "has_image_update" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_container_updates" ADD COLUMN "newer_version" text;--> statement-breakpoint
ALTER TABLE "stack_sources" ADD COLUMN "secret_provider_id" integer;--> statement-breakpoint
ALTER TABLE "stack_sources" ADD COLUMN "injected_secret_keys" text;--> statement-breakpoint
ALTER TABLE "stack_sources" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "container_icon_overrides" ADD CONSTRAINT "container_icon_overrides_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_sources" ADD CONSTRAINT "stack_sources_secret_provider_id_secret_providers_id_fk" FOREIGN KEY ("secret_provider_id") REFERENCES "public"."secret_providers"("id") ON DELETE set null ON UPDATE no action;