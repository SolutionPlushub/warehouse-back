-- Historique des conteneurs : la date affichée d'un Gate OUT / Gate IN était
-- l'heure d'ENREGISTREMENT, pas la date réelle saisie (sortie du 22/09 saisie
-- le 15/10 → affichée au 15/10). On aligne le dernier mouvement de chaque
-- conteneur sur sa date réelle de sortie / d'entrée.
UPDATE "yard_movements" AS m
SET "confirmedAt" = c."gateOutDate"
FROM "yard_containers" AS c
WHERE m."yardContainerId" = c."id"
  AND m."movementType" = 'GATE_OUT'
  AND c."gateOutDate" IS NOT NULL
  AND m."id" = (
    SELECT m2."id" FROM "yard_movements" AS m2
    WHERE m2."yardContainerId" = c."id" AND m2."movementType" = 'GATE_OUT'
    ORDER BY m2."createdAt" DESC LIMIT 1
  );

UPDATE "yard_movements" AS m
SET "confirmedAt" = c."gateInDate"
FROM "yard_containers" AS c
WHERE m."yardContainerId" = c."id"
  AND m."movementType" = 'GATE_IN'
  AND c."gateInDate" IS NOT NULL
  AND m."id" = (
    SELECT m2."id" FROM "yard_movements" AS m2
    WHERE m2."yardContainerId" = c."id" AND m2."movementType" = 'GATE_IN'
    ORDER BY m2."createdAt" DESC LIMIT 1
  );
