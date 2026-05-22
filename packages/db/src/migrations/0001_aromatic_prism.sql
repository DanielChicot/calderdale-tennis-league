CREATE TYPE "public"."fixture_status" AS ENUM('scheduled', 'completed', 'postponed', 'unfinished', 'rearranged-postponed', 'rearranged-unfinished', 'rubbers-conceded', 'match-conceded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixtures" (
	"id" serial PRIMARY KEY NOT NULL,
	"upstream_id" integer,
	"date" date NOT NULL,
	"home_team_id" integer NOT NULL,
	"away_team_id" integer NOT NULL,
	"division_id" integer NOT NULL,
	"status" "fixture_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "results" (
	"fixture_id" integer PRIMARY KEY NOT NULL,
	"home_score" numeric NOT NULL,
	"away_score" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"fixture_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rubbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_card_id" integer NOT NULL,
	"order_in_card" integer NOT NULL,
	"home_player_ids" integer[] NOT NULL,
	"away_player_ids" integer[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "set_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"rubber_id" integer NOT NULL,
	"order_in_rubber" integer NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "results" ADD CONSTRAINT "results_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_cards" ADD CONSTRAINT "match_cards_fixture_id_fixtures_id_fk" FOREIGN KEY ("fixture_id") REFERENCES "public"."fixtures"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rubbers" ADD CONSTRAINT "rubbers_match_card_id_match_cards_id_fk" FOREIGN KEY ("match_card_id") REFERENCES "public"."match_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "set_scores" ADD CONSTRAINT "set_scores_rubber_id_rubbers_id_fk" FOREIGN KEY ("rubber_id") REFERENCES "public"."rubbers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixtures_upstream_idx" ON "fixtures" USING btree ("upstream_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "match_cards_fixture_idx" ON "match_cards" USING btree ("fixture_id");