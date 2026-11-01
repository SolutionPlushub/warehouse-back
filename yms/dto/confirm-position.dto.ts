import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ConfirmPositionDto {
  @IsString()
  @IsNotEmpty()
  positionId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
