import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Retour à l'étape précédente — sur les unités indiquées (toutes les unités
// engagées de l'opération par défaut, qui doivent alors être à la même
// étape). Le motif est obligatoire et tracé (OperationStepLog + audit).
export class RewindOperationDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  operationLineIds?: string[];

  @IsString({ message: 'Le motif est requis.' })
  @IsNotEmpty({ message: 'Le motif est requis.' })
  @MaxLength(500, { message: 'Le motif ne doit pas dépasser 500 caractères.' })
  reason: string;
}
