import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

// Correction d'un GatePass déjà enregistré : date/heure réelle, camion,
// chauffeur et unités arrivées sur ce passage (une unité reprise d'un autre
// passage en est retirée). Miroir de updateGatePass() côté frontend.
export class UpdateGatePassDto {
  @ApiPropertyOptional({ example: '2026-09-15T08:30:00.000Z' })
  @IsOptionalDateString()
  gateInAt?: string;

  @IsOptional()
  @IsString()
  truckPlate?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverCin?: string;

  @IsOptional()
  @IsString()
  permitNo?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  arrivedOperationLineIds?: string[];
}
