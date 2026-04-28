CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"model" text NOT NULL,
	"source" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_tenths" integer DEFAULT 0 NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"access_engine" boolean DEFAULT true NOT NULL,
	"access_enginegpt" boolean DEFAULT true NOT NULL,
	"access_operations" boolean DEFAULT false NOT NULL,
	"access_admin" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "customer_id" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "attachments" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ai_context_config" jsonb DEFAULT '{"contracts":true,"contentPipeline":true,"socialPresence":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "ai_cu_description" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE no action ON UPDATE no action;