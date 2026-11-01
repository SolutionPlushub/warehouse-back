import {
  IsArray,
  IsOptional,
  IsString,
  ArrayNotEmpty,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';
import { FleetOwnership } from '@prisma/client';

// Un passage camion au Gate In d'un dossier — peut ne présenter qu'une
// partie des unités attendues (entrée partielle). Miroir de
// gateInDossier(id, data) côté frontend (dos-store.js).
export class GateInPassDto {
  @ApiPropertyOptional({ enum: FleetOwnership, default: FleetOwnership.EXTERNAL })
  @IsOptional()
  @IsEnum(FleetOwnership)
  transportMode?: FleetOwnership;

  @ApiPropertyOptional({ description: 'Véhicule TMS sélectionné' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Chauffeur TMS sélectionné' })
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ example: 'DK-1234-AA' })
  @IsOptional()
  @IsString()
  truckPlate?: string;

  @ApiPropertyOptional({ example: 'Transport Sénégal SARL' })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ example: 'Moussa Diop' })
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional({ description: 'Numéro de pièce d’identité du chauffeur' })
  @IsOptional()
  @IsString()
  driverCin?: string;

  @ApiPropertyOptional({ description: 'Numéro de permis de conduire du chauffeur' })
  @IsOptional()
  @IsString()
  permitNo?: string;

  // Ids des OperationLine (role=INPUT) présentées sur ce passage — toutes
  // les unités encore attendues par défaut si omis.
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  arrivedOperationLineIds?: string[];

  // Date/heure réelle du passage au Gate — saisie manuelle (ex: passage
  // enregistré après coup, décalage papier/système). Par défaut : now()
  // côté serveur si omis. Alimente GatePass.gateInDate (distinct de
  // createdAt, jamais modifié — intégrité de l'audit) ET
  // YardContainer.gateInDate des conteneurs arrivés sur ce passage.
  @ApiPropertyOptional({ example: '2026-09-15T08:30:00.000Z' })
  @IsOptionalDateString()
  gateInAt?: string;
}
