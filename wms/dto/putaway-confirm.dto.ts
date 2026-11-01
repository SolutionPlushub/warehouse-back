import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PutawayLineDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  yardId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;
}

// Étape 4 — Gestionnaire de stock confirme la mise en place
export class PutawayConfirmDto {
  @IsOptional()
  @IsString()
  putawayNote?: string;

  // Emplacements par ligne — si absent, pas de mise à jour des lignes
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PutawayLineDto)
  lines?: PutawayLineDto[];
}
