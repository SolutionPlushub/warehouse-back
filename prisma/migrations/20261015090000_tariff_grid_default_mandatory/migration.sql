-- Les charges d'un dossier sont désormais résolues DIRECTEMENT depuis la
-- grille tarifaire : un tarif « Obligatoire » applicable à une opération du
-- dossier est porté automatiquement en finance (voir grid-resolver.ts).
-- Aucune grille n'avait de tarif obligatoire : on pose les valeurs par défaut
-- de la grille DMT 2026 (forfaits de dépotage, manutention, stockage,
-- relevage, déchargement camion, détention camion), UNIQUEMENT pour les
-- tenants dont la grille n'a encore aucun tarif obligatoire — une grille déjà
-- réglée à la main n'est jamais écrasée.
UPDATE "tariff_refs" AS t
SET "mandatory" = true
WHERE t."code" IN (
    'T-DEP-01', 'T-DEP-02',
    'T-TRN-01', 'T-TRN-02', 'T-TRN-03', 'T-TRN-04', 'T-TRN-06', 'T-TRN-07',
    'T-LOC-01', 'T-LOC-02', 'T-LOC-05', 'T-LOC-06', 'T-LOC-07',
    'T-WH-01', 'T-WH-02', 'T-WH-04', 'T-WH-05',
    'T-YRD-01', 'T-YRD-02', 'T-YRD-03', 'T-YRD-04', 'T-YRD-05', 'T-YRD-06',
    'T-OPS-07'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "tariff_refs" AS m
    WHERE m."tenantId" = t."tenantId" AND m."mandatory" = true
  );
