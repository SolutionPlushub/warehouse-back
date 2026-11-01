import { IsOptional, IsString, MaxLength } from 'class-validator';

// Décision DEX sur la facture (préalable à toute sortie §15) — distincte de
// la validation DEX sur Operation. Miroir de dexValidateInvoice() côté
// frontend.
export class DexDecideInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
