import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RepositionDto {
  @IsString()
  @IsNotEmpty()
  toPositionId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
