import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// Gate In du camion vide récepteur (option 2 du transbordement) : il entre
// pour charger la marchandise dépotée, indépendamment des porteurs.
export class ReceiverGateInDto {
  @ApiProperty({ example: 'AA 123 BB' })
  @IsString()
  @IsNotEmpty()
  plate: string;

  @ApiProperty({ example: 'Transports Diallo' })
  @IsString()
  @IsNotEmpty()
  carrier: string;

  @ApiProperty({ example: 'Moussa Ndiaye' })
  @IsString()
  @IsNotEmpty()
  driverName: string;

  @ApiProperty({ example: '1 234 1990 01234' })
  @IsString()
  @IsNotEmpty()
  driverCin: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permitNo?: string;

  // Date/heure réelle d'entrée (défaut : maintenant).
  @ApiPropertyOptional({ example: '2026-10-25T08:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  gateInAt?: string;
}

// Sortie d'un camion (porteur ou récepteur) à sa date réelle.
export class TransshipExitDto {
  @ApiPropertyOptional({ example: '2026-10-25T16:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  gateOutAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryRef?: string;
}

// Sortie partielle des porteurs : conteneurs vides repartant après dépotage.
export class CarrierExitDto extends TransshipExitDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  operationLineIds: string[];
}
