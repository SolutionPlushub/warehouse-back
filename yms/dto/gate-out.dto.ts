import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FleetOwnership } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class GateOutDto {
  @IsOptionalDateString()
  gateOutDate?: string;

  @ApiPropertyOptional({ enum: FleetOwnership, default: FleetOwnership.EXTERNAL })
  @IsOptional()
  @IsEnum(FleetOwnership)
  transportMode?: FleetOwnership;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  truckPlate?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

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
  notes?: string;

  // Régularisation : sortie physique déjà faite mais jamais saisie (camion
  // inconnu). Date réelle et motif obligatoires, pas de transport exigé.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  regularization?: boolean;
}
