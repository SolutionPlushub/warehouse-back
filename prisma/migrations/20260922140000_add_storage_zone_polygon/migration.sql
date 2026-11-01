-- Tracé de la zone d'entreposage à l'intérieur du périmètre du yard — voir
-- YardBlockDef.polygon pour le même format (points {x,y} en %).
ALTER TABLE "storage_zones" ADD COLUMN "polygon" JSONB;
