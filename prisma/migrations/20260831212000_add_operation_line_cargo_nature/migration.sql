-- Ajoute la nature de cargaison (Vrac | Conventionnel) sur OperationLine —
-- règle §5 de la Note logique de service DMT Hub : taille (déjà disponible
-- via YardContainer.sizeFt) + nature obligatoires pour résoudre la
-- prestation induite de dépotage/empotage correspondante (IS-07..IS-14).
ALTER TABLE "operation_lines" ADD COLUMN     "cargoNature" TEXT;
