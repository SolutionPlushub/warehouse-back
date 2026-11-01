-- Taille des conteneurs déduite du code de type ISO (1er caractère :
-- 2 → 20', 4 → 40', 45…/L… → 45'). Les types créés à la volée depuis les
-- formulaires (ex. « 40FT ») recevaient la taille par défaut 20' : les 40'
-- saisis avec ces types comptaient 1 EVP au lieu de 2 (ex. dossier HMM2609A).

-- 1. Référentiel des types
UPDATE "container_type_refs" SET "sizeFt" = 45
WHERE upper("code") ~ '^(45|L)' AND "sizeFt" <> 45;
UPDATE "container_type_refs" SET "sizeFt" = 40
WHERE upper("code") ~ '^4' AND upper("code") !~ '^45' AND "sizeFt" < 40;

-- 2. Conteneurs (tous statuts : les sortis gardent un EVP juste pour les rapports)
UPDATE "yard_containers" SET "sizeFt" = 45
WHERE upper("isoTypeCode") ~ '^(45|L)' AND "sizeFt" <> 45;
UPDATE "yard_containers" SET "sizeFt" = 40
WHERE upper("isoTypeCode") ~ '^4' AND upper("isoTypeCode") !~ '^45' AND "sizeFt" < 40;

-- 3. Lignes de pré-gate (pré-remplissage des Gate In à venir)
UPDATE "pre_gate_lines" SET "sizeFt" = 45
WHERE upper("isoTypeCode") ~ '^(45|L)' AND "sizeFt" <> 45;
UPDATE "pre_gate_lines" SET "sizeFt" = 40
WHERE upper("isoTypeCode") ~ '^4' AND upper("isoTypeCode") !~ '^45' AND "sizeFt" < 40;
