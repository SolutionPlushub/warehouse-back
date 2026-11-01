import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TruckLoadLineDto {
  // Unité (conteneur dépoté) dont une partie est chargée sur ce camion.
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  // Nombre de colis chargés depuis cette unité sur ce camion.
  @IsInt()
  @Min(1)
  quantity: number;
}

// Chargement d'un camion : une ou plusieurs parties de conteneurs, de un ou
// plusieurs dossiers (chargements partiels).
export class CreateTruckLoadDto {
  @IsString()
  @IsNotEmpty()
  plate: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsString()
  @IsNotEmpty()
  driverName: string;

  @IsOptional()
  @IsString()
  driverCin?: string;

  @IsOptional()
  @IsString()
  permitNo?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  deliveryRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TruckLoadLineDto)
  lines: TruckLoadLineDto[];

  // Date/heure réelle du chargement (défaut : maintenant).
  @IsOptional()
  @IsDateString()
  loadedAt?: string;
}

export class TruckLoadGateOutDto {
  @IsOptional()
  @IsDateString()
  gateOutAt?: string;

  @IsOptional()
  @IsString()
  deliveryRef?: string;
}

export class TruckLoadDeliverDto {
  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @IsOptional()
  @IsString()
  deliveryRef?: string;
}
