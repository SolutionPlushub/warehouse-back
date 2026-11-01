import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class CreateContainerTypeRefDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  code?: string; // si absent, généré automatiquement depuis label

  @IsOptional()
  @IsString()
  isoPrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(20) @Max(53)
  sizeFt?: number;

  @IsOptional()
  @IsString()
  family?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
