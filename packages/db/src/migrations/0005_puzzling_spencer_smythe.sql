CREATE TABLE IF NOT EXISTS "standings" (
	"team_id" integer PRIMARY KEY NOT NULL,
	"division_id" integer NOT NULL,
	"position" integer NOT NULL,
	"results_received" integer NOT NULL,
	"results_total" integer NOT NULL,
	"points_won" numeric NOT NULL,
	"points_lost" numeric NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "upstream_team_id" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standings" ADD CONSTRAINT "standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "standings" ADD CONSTRAINT "standings_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standings_division_id_idx" ON "standings" USING btree ("division_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_upstream_team_id_idx" ON "teams" USING btree ("upstream_team_id") WHERE upstream_team_id IS NOT NULL;