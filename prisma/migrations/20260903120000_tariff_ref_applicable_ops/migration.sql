-- Types d'opération auxquels un tarif s'applique — miroir de `ops: string[]`
-- côté mock frontend (DOS_TARIFFS/DOS_SERVICES, lib/data/data-dos.js), pour
-- couvrir DosConfig.tariffsFor(ops)/toggleTariffOp() une fois le store
-- branché sur l'API. Tableau vide = applicable à toutes les opérations
-- (équivalent du marqueur '*' côté mock, qu'un enum Postgres ne peut pas
-- porter littéralement). Distinct du lien TariffRef -> InducedServiceRef ->
-- OperationInducedRule.operationType déjà existant, qui ne relie un tarif à
-- un type d'opération que via une prestation induite précise.
ALTER TABLE "tariff_refs" ADD COLUMN     "applicableOps" "OperationType"[] DEFAULT ARRAY[]::"OperationType"[];
