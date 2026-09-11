ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_conversation_id_ai_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;