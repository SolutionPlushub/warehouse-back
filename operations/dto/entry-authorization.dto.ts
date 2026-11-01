import { IsBoolean, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Bon à Entrer (BAE). Les trois contrôles sont facultatifs pour le moment :
// la finance les reprend après l'émission.
export class EntryAuthorizationDto {
  @ApiProperty({ description: 'Contrat client confirmé', required: false })
  @IsOptional()
  @IsBoolean()
  checkContract?: boolean;

  @ApiProperty({ description: 'Compte client vérifié', required: false })
  @IsOptional()
  @IsBoolean()
  checkAccount?: boolean;

  @ApiProperty({ description: 'Devis confirmé', required: false })
  @IsOptional()
  @IsBoolean()
  checkQuote?: boolean;

  // Date/heure réelle d'émission du Bon à Entrer (défaut : maintenant) —
  // était ignorée, d'où des BAE datés du jour de la saisie de rattrapage.
  @ApiProperty({ required: false, example: '2026-09-15T08:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  issuedAt?: string;
}
