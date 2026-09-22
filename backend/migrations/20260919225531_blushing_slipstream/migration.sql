CREATE TABLE "scoreboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"gameName" varchar(255) NOT NULL,
	"players" jsonb DEFAULT '[]',
	"creationTime" timestamp with time zone DEFAULT now(),
	"updateTime" timestamp with time zone DEFAULT now()
);
