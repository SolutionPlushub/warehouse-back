import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Envoi du Bon à Entrer par e-mail — miroir de emailEntryPass(id, to, cc,
// message) côté frontend (dos-store.js). to/cc : liste brute séparée par
// virgule/point-virgule, parsée et validée côté service (mêmes règles que
// le mock — au moins un destinataire, adresses bien formées).
export class EmailEntryPassDto {
  @ApiProperty({ example: 'client@exemple.sn, agent@dmt.sn' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiPropertyOptional({ example: 'compta@dmt.sn' })
  @IsOptional()
  @IsString()
  cc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
