-- Rattachement automatique du camion transportant une OperationLine — posé
-- via advance(data.loadplan), typiquement à l'étape "Gate In véhicule"
-- d'une opération sortante. Miroir de l.truck côté frontend (dos-store.js
-- executeOpStep()).
ALTER TABLE "operation_lines" ADD COLUMN     "truckAssignedAt" TIMESTAMP(3),
ADD COLUMN     "truckCarrier" TEXT,
ADD COLUMN     "truckPlate" TEXT;
