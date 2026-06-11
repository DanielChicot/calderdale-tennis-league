CREATE TABLE IF NOT EXISTS "team_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"role" varchar(64),
	"phone" varchar(32),
	"email" varchar(128)
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "upstream_club_id" integer;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "postcode" varchar(10);--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "lat" numeric;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "lng" numeric;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_contacts" ADD CONSTRAINT "team_contacts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_contacts_team_id_idx" ON "team_contacts" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clubs_upstream_club_id_idx" ON "clubs" USING btree ("upstream_club_id") WHERE upstream_club_id IS NOT NULL;