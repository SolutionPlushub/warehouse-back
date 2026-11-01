-- Obligatoire/optionnel purement informatif pour une ligne manuelle
-- (mandatory reste null, protégé de InducedServicesService.resolve()).
ALTER TABLE "shipment_file_service_lines" ADD COLUMN "displayMandatory" BOOLEAN;
