ALTER TABLE "scoreboards" ADD COLUMN "code" varchar(6);--> statement-breakpoint
ALTER TABLE "scoreboards" ADD CONSTRAINT "scoreboards_code_key" UNIQUE("code");