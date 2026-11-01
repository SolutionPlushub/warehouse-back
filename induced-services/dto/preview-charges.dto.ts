import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContainerType, OperationType } from '@prisma/client';

export class PreviewContainerDto {
  @IsOptional()
  @IsInt()
  @IsIn([20, 40, 45])
  sizeFt?: number;

  @IsOptional()
  @IsEnum(ContainerType)
  containerType?: ContainerType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossWeightKg?: number;
}

// Aperçu des charges d'un dossier pas encore créé (wizard, étape Finance) —
// même calcul que la résolution d'un dossier existant, sans persistance.
export class PreviewChargesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(OperationType, { each: true })
  operationTypes: OperationType[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviewContainerDto)
  containers?: PreviewContainerDto[];

  @IsOptional()
  @IsString()
  regimeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  freetime?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  surfaceM2?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;
}
