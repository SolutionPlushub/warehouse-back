-- Ajoute le suivi d'avancement par unité de cargaison à travers le pipeline
-- d'étapes de chaque type d'opération (OPERATION_TYPE_CFG[type].steps) —
-- miroir de `l.ops[opId]` côté frontend (dos-store.js executeOpStep()).
ALTER TABLE "operation_lines" ADD COLUMN     "done" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stepIdx" INTEGER NOT NULL DEFAULT 0;

-- Journal d'avancement (une ligne par étape franchie) — traçabilité.
CREATE TABLE "operation_step_logs" (
    "id" TEXT NOT NULL,
    "operationLineId" TEXT NOT NULL,
    "stepIdx" INTEGER NOT NULL,
    "stepLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_step_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "operation_step_logs_operationLineId_idx" ON "operation_step_logs"("operationLineId");

ALTER TABLE "operation_step_logs" ADD CONSTRAINT "operation_step_logs_operationLineId_fkey" FOREIGN KEY ("operationLineId") REFERENCES "operation_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
