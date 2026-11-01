import { IsString, IsOptional } from 'class-validator';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

// Étape 2 — Suivi douanier : complète les infos douanières d'un dossier DRAFT
export class CustomsUpdateDto {
  @IsOptional()
  @IsString()
  storageRegimeCode?: string;

  @IsOptional()
  @IsString()
  customsDeclNumber?: string;

  @IsOptionalDateString()
  customsDeclDate?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  transportDocNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
