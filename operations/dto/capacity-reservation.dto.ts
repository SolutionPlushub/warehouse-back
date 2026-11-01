import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Emplacement ICD (yard) affecté à une OperationLine — un des deux modes de
// CapacityReservationDto. Miroir de alloc.slots[] côté frontend
// (dos-store.js reserveCapacity()).
export class CapacitySlotDto {
  @ApiProperty({ description: 'Id de l’OperationLine concernée' })
  @IsString()
  operationLineId: string;

  @ApiProperty({ example: 'N1' })
  @IsString()
  block: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  bay: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  row: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  tier: number;
}

// Réservation de capacité pour une Operation — soit un lot d'emplacements
// ICD (yard, un par unité), soit une surface entrepôt (m²) dans une zone.
// Miroir de reserveCapacity(id, alloc) côté frontend (dos-store.js).
export class CapacityReservationDto {
  @ApiProperty({ enum: ['icd', 'warehouse'] })
  @IsIn(['icd', 'warehouse'])
  mode: 'icd' | 'warehouse';

  @ApiPropertyOptional({ type: [CapacitySlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapacitySlotDto)
  slots?: CapacitySlotDto[];

  @ApiPropertyOptional({ description: 'Id du Yard (mode=warehouse)' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'Id de la StorageZone (mode=warehouse)' })
  @IsOptional()
  @IsString()
  zoneId?: string;

  @ApiPropertyOptional({
    description: 'Surface à réserver en m² (mode=warehouse)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  surfaceM2?: number;
}
