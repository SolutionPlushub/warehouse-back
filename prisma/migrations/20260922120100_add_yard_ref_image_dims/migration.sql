-- Dimensions naturelles (px) de l'image de référence utilisée pour tracer
-- le périmètre/la calibration — voir Yard.metersPerPixel.
ALTER TABLE "yards" ADD COLUMN "refImageWidth" INTEGER;
ALTER TABLE "yards" ADD COLUMN "refImageHeight" INTEGER;
