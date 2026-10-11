CREATE TYPE "public"."crawl_job_status" AS ENUM('discovered', 'running', 'complete', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatbot_id" uuid NOT NULL,
	"root_url" text NOT NULL,
	"status" "crawl_job_status" DEFAULT 'discovered' NOT NULL,
	"discovered_pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"completed_pages" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "raw_content_hash" text;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_chatbot_id_chatbots_id_fk" FOREIGN KEY ("chatbot_id") REFERENCES "public"."chatbots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_jobs_chatbot_created_idx" ON "crawl_jobs" USING btree ("chatbot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_chatbot_url_unique" ON "sources" USING btree ("chatbot_id","url");