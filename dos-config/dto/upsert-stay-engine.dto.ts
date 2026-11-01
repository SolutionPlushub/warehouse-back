import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertStayEngineDto {
  @ApiPropertyOptional({
    example: 31,
    description: 'Seuil (jours) à partir duquel le tarif mensuel remplace le journalier',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  monthlyThresholdDays?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Jours avant fin de franchise pour alerter (0 = désactivé)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  alertLeadDays?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Compter les week-ends (et fériés) dans le séjour',
  })
  @IsOptional()
  @IsBoolean()
  weekendsIncluded?: boolean;
}
