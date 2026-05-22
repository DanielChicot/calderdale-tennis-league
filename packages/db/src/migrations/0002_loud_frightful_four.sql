CREATE TYPE "public"."ranking_movement" AS ENUM('up', 'down', 'same', 'new');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rankings" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"division_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"rubbers_won" numeric NOT NULL,
	"rubbers_played" numeric NOT NULL,
	"games_won" integer NOT NULL,
	"games_played" integer NOT NULL,
	"ranking_score" numeric NOT NULL,
	"movement" "ranking_movement" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_runs" (
	"url" varchar(512) PRIMARY KEY NOT NULL,
	"last_fetched_at" timestamp with time zone NOT NULL,
	"last_modified" varchar(64),
	"content_hash" varchar(64),
	"last_status" integer NOT NULL,
	"last_parse_ok" boolean NOT NULL,
	"last_error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rankings" ADD CONSTRAINT "rankings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rankings" ADD CONSTRAINT "rankings_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rankings_player_division_idx" ON "rankings" USING btree ("player_id","division_id");