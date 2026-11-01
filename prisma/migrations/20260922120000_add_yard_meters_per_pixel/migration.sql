-- Échelle réelle du tracé du yard (mètres par pixel, à la résolution
-- naturelle de l'image de référence utilisée lors du traçage du périmètre).
-- Calculée une fois via une ligne de calibration (longueur réelle connue)
-- tracée en même temps que le périmètre — voir Yard.perimeter. Sert à
-- convertir la taille de slot (mètres) en dimensions de grille (rows/bays)
-- lors du traçage des blocs à l'intérieur du périmètre.
ALTER TABLE "yards" ADD COLUMN "metersPerPixel" DOUBLE PRECISION;
