import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class ReceiveLineDto {
  @IsOptional()
  @IsString()
  id?: string; // présent si la ligne existe déjà en base (mise à jour), absent si nouvelle

  @IsString()
  packageRef: string;

  @IsOptional()
  @IsString()
  packageTypeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageCount?: number;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  volumeM3?: number;

  @IsOptional()
  @IsNumber()
  surfaceM2?: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ReceiveShipmentDto {
  @IsOptionalDateString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  transportDocNumber?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  truckPlate?: string;

  @IsOptional()
  @IsString()
  targetLocation?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  comments?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];
}
