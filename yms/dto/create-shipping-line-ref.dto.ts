import { IsString, IsOptional, IsBoolean, IsInt, Min, IsNotEmpty } from 'class-validator';

export class CreateShippingLineRefDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  code?: string; // si absent, généré automatiquement depuis label

  @IsOptional()
  @IsString()
  scac?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
