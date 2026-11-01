-- Plan du site (image de fond, asset frontend statique — pas d'upload).
ALTER TABLE "yards" ADD COLUMN "planImageUrl" TEXT;

-- Tracé du polygone d'un bloc/zone sur le plan du site — points en % (0-100)
-- de la largeur/hauteur de l'image, indépendant de la résolution.
ALTER TABLE "yard_block_defs" ADD COLUMN "polygon" JSONB;
