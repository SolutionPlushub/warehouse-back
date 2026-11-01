-- 1. Tarifs obligatoires par défaut (suite de 20261015090000). La migration
--    précédente ne touchait que les grilles SANS aucun tarif obligatoire ; en
--    production la grille DMT en avait déjà un coché à la main (T-WH-05) et
--    a donc été ignorée : aucune charge n'était reprise dans les dossiers.
--    On complète ici toute grille qui compte moins de 3 tarifs obligatoires
--    (grille jamais réellement paramétrée). Ne fait que COCHER : aucun tarif
--    obligatoire n'est décoché.
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
  AND t."isActive" = true
  AND (
    SELECT count(*) FROM "tariff_refs" AS m
    WHERE m."tenantId" = t."tenantId" AND m."mandatory" = true AND m."isActive" = true
  ) < 3;

-- 2. Conteneurs des dossiers « Stockage conteneurs vides » (ICD_EMPTY) encore
--    sur site : ils sont vides par définition (ils avaient été enregistrés
--    sec/reefer → tarif plein, et refusés par les blocs faute de bloc reefer).
UPDATE "yard_containers" AS c
SET "containerType" = 'EMPTY'
WHERE c."containerType" <> 'EMPTY'
  AND c."status" <> 'DEPARTED'
  AND EXISTS (
    SELECT 1 FROM "operation_lines" AS ol
    JOIN "operations" AS o ON o."id" = ol."operationId"
    WHERE ol."yardContainerId" = c."id" AND o."type" = 'ICD_EMPTY'
  );
