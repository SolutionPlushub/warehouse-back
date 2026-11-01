import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ContainerType } from '@prisma/client';

// Correction d'un conteneur rattaché à un dossier (erreur de saisie : n°,
// type, taille, plomb, poids, BL). Motif facultatif, tracé dans l'audit.
export class UpdateCargoContainerDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{4}\d{7}$/, {
    message: 'Le n° de conteneur doit comporter 4 lettres et 7 chiffres.',
  })
  containerNumber?: string;

  @IsOptional()
  @IsString()
  isoTypeCode?: string;

  @IsOptional()
  @IsInt()
  @IsIn([20, 40, 45])
  sizeFt?: number;

  @IsOptional()
  @IsEnum(ContainerType)
  containerType?: ContainerType;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  bl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  packageCount?: number;

  // Facultatif : la correction est de toute façon tracée dans l'audit.
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Le motif ne doit pas dépasser 500 caractères.' })
  reason?: string;
}
