import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContainerType, TransportMode } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class UpdatePreGateLineInputDto {
  // Présent = ligne existante à mettre à jour ; absent = nouvelle ligne à créer
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  containerNumber: string;

  @IsString()
  isoTypeCode: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(45)
  sizeFt?: number;

  @IsOptional()
  @IsEnum(ContainerType)
  containerType?: ContainerType;

  @IsOptional()
  @IsNumber()
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;

  @IsOptional()
  @IsBoolean()
  customsHold?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePreGateDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  voyageCode?: string;

  @IsOptional()
  @IsString()
  vesselName?: string;

  @IsOptionalDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  transportMode?: TransportMode;

  @IsOptional()
  @IsString()
  notes?: string;

  // Liste complète des lignes voulues après édition (existantes conservées via id, absentes supprimées)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePreGateLineInputDto)
  lines?: UpdatePreGateLineInputDto[];
}
