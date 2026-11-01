-- Le dépôt n'utilise plus d'image de référence externe : son propre tracé
-- (perimeter) sert désormais de plan de référence. Ces colonnes ne sont
-- plus référencées côté frontend/backend.
ALTER TABLE "yards" DROP COLUMN "planImageUrl";
ALTER TABLE "yards" DROP COLUMN "metersPerPixel";
ALTER TABLE "yards" DROP COLUMN "refImageWidth";
ALTER TABLE "yards" DROP COLUMN "refImageHeight";
