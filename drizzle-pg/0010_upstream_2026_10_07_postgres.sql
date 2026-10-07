CREATE TABLE "container_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"container_name" text NOT NULL,
	"environment_id" integer,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "container_tags_container_name_environment_id_tag_id_unique" UNIQUE("container_name","environment_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"webauthn_user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "stack_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"stack_name" text NOT NULL,
	"environment_id" integer,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "stack_tags_stack_name_environment_id_tag_id_unique" UNIQUE("stack_name","environment_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"icon" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unique" ON "tags" (lower("name"));--> statement-breakpoint
ALTER TABLE "pending_container_updates" ADD COLUMN "release_age_remaining_hours" integer;--> statement-breakpoint
ALTER TABLE "container_tags" ADD CONSTRAINT "container_tags_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_tags" ADD CONSTRAINT "container_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_tags" ADD CONSTRAINT "stack_tags_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_tags" ADD CONSTRAINT "stack_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_id_idx" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credentials_user_name_unique" ON "passkey_credentials" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "schedule_executions_entity_env_idx" ON "schedule_executions" USING btree ("entity_name","environment_id");