import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetDefaultYardDto {
  @ApiPropertyOptional({
    example: 'clxyz789',
    description: 'ID du yard à utiliser par défaut — omettre ou null pour retirer la préférence',
  })
  @IsOptional()
  @IsString()
  yardId?: string | null;
}
