import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaymentTermType, PaymentMethod } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

// Modalité de paiement saisie à la création d'un ShipmentFile (WMS) ou d'un
// PreGate (YMS) — AT_PICKUP bloque la sortie tant qu'un directeur (ADMIN) n'a
// pas validé manuellement ; ON_CREDIT ne bloque jamais, dueDate est indicative.
export class PaymentTermDto {
  @IsEnum(PaymentTermType)
  termType: PaymentTermType;

  // Moyen de règlement effectif (espèces/virement/chèque) — distinct de
  // termType (QUAND) : ceci décrit COMMENT. Sert au calcul du timbre fiscal
  // (InvoicesService.computeTotals()) : 1% du sous-total en espèces
  // uniquement.
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptionalDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
