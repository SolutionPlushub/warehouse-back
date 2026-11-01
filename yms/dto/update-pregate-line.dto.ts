import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PreGateLineStatus } from '@prisma/client';

export class UpdatePreGateLineDto {
  @IsOptional()
  @IsEnum(PreGateLineStatus)
  status?: PreGateLineStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
