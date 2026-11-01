import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNotEmpty,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class ExitLineDto {
  @IsString()
  @IsNotEmpty()
  shipmentLineId: string;

  @IsInt()
  @Min(1)
  quantityOut: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateExitMovementDto {
  // Étape 1 — Bon de livraison
  @IsOptional()
  @IsString()
  deliveryOrderRef?: string;

  @IsOptionalDateString()
  exitDate?: string;

  @IsOptional()
  @IsString()
  exitShipmentTypeCode?: string;

  @IsOptional()
  @IsString()
  exitVoyageCode?: string;

  @IsOptional()
  @IsString()
  exitCustomsDecl?: string;

  @IsOptional()
  @IsString()
  exitTransportDoc?: string;

  // Étape 2 — Sélection marchandises
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExitLineDto)
  exitLines: ExitLineDto[];

  // Étape 3 — Gate (optionnel à la création, requis à la confirmation)
  @IsOptional()
  @IsString()
  truckPlate?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
