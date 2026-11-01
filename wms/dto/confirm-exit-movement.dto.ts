import { IsString, IsOptional } from 'class-validator';

export class ConfirmExitMovementDto {
  @IsOptional()
  @IsString()
  truckPlate?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
