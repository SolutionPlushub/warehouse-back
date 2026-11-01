import {
  IsString, IsOptional, IsInt, IsNumber, IsPositive, IsNotEmpty, Min,
} from 'class-validator';

export class CreateShipmentLineDto {
  @IsString()
  @IsNotEmpty()
  packageRef: string;

  @IsOptional()
  @IsString()
  packageTypeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  volumeM3?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  surfaceM2?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  yardId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;
}
