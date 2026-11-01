-- Le commentaire DEX doit pouvoir être conservé aussi bien sur une
-- validation positive que sur un rejet — miroir de dexValidateInvoice()
-- côté frontend, qui stocke `comment` dans les deux cas.
ALTER TABLE "invoices" ADD COLUMN     "dexValidationComment" TEXT;
