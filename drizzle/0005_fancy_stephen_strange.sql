CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chatbot_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatbots" ALTER COLUMN "widget_config" SET DEFAULT '{"color":"#7065e8","position":"right","welcomeMessage":"Hi! How can I help you today?","starterQuestions":[],"allowedDomains":[],"leadCapture":false}'::jsonb;--> statement-breakpoint
UPDATE "chatbots" SET "widget_config" = jsonb_set("widget_config", '{leadCapture}', 'false'::jsonb, true) WHERE NOT ("widget_config" ? 'leadCapture');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_chatbot_id_chatbots_id_fk" FOREIGN KEY ("chatbot_id") REFERENCES "public"."chatbots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_conversation_unique" ON "leads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "leads_workspace_created_idx" ON "leads" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_chatbot_created_idx" ON "leads" USING btree ("chatbot_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_rating_valid" CHECK ("messages"."rating" IS NULL OR "messages"."rating" IN (-1, 1));
