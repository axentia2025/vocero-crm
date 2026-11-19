ALTER TABLE "contact" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_org_owner_idx" ON "contact" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
-- Lo que ya existía es del propietario (el primero, si hubiera más de uno).
-- Lo que llegue después por WhatsApp nace sin asignar y solo lo ve él.
UPDATE "contact" AS c
SET "owner_user_id" = d."user_id"
FROM (
  SELECT DISTINCT ON (m."organization_id") m."organization_id", m."user_id"
  FROM "member" m
  WHERE m."role" = 'owner'
  ORDER BY m."organization_id", m."created_at" ASC
) AS d
WHERE c."organization_id" = d."organization_id"
  AND c."owner_user_id" IS NULL;
