-- Flag minimal de validation DEX avant sortie (règle §15 du cahier des
-- charges) — en attendant le modèle DEX complet (signature/cachet/mention),
-- identifié comme chantier à part entière.
ALTER TABLE "operations" ADD COLUMN     "dexValidatedAt" TIMESTAMP(3),
ADD COLUMN     "dexValidatedById" TEXT;
