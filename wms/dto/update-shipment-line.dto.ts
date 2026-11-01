import { IsEnum, IsOptional, IsString, IsNumber, IsPositive, IsInt, Min } from 'class-validator';
import { ShipmentLineStatus } from '@prisma/client';

export class UpdateShipmentLineDto {
  @IsOptional()
  @IsEnum(ShipmentLineStatus)
  status?: ShipmentLineStatus;

  @IsOptional()
  @IsString()
  yardId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  packageRef?: string;

  @IsOptional()
  @IsString()
  packageTypeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  volumeM3?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  surfaceM2?: number;

  @IsOptional()
  @IsString()
  description?: string;
}
