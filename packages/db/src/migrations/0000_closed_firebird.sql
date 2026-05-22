CREATE TYPE "public"."division_group" AS ENUM('Mens', 'Ladies', 'Mixed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "divisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"group" "division_group" NOT NULL,
	"season_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "club_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"club_id" integer NOT NULL,
	"observed_name" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"canonical_name" varchar(128) NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(128) NOT NULL,
	"club_id" integer NOT NULL,
	"division_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"observed_name" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(96) NOT NULL,
	"name" varchar(128) NOT NULL,
	"btm_number" varchar(16),
	"club_id" integer NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "divisions" ADD CONSTRAINT "divisions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "club_aliases" ADD CONSTRAINT "club_aliases_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_slug_idx" ON "seasons" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "divisions_slug_season_idx" ON "divisions" USING btree ("slug","season_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "club_aliases_name_idx" ON "club_aliases" USING btree ("observed_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_slug_idx" ON "clubs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_division_idx" ON "teams" USING btree ("slug","division_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_aliases_name_idx" ON "player_aliases" USING btree ("observed_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_slug_idx" ON "players" USING btree ("slug");