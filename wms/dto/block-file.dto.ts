import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Blocage comptable au niveau dossier — distinct du blocage client
// (ClientAccountingBlock). Réservé DEX/ADMIN/SUPER_ADMIN. Miroir de
// blockDossier(id, reason) côté frontend (dos-store.js).
export class BlockFileDto {
  @ApiPropertyOptional({ example: 'Factures impayées' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
