import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContainerType, TransportMode } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';
import { PaymentTermDto } from '../../payments/dto/payment-term.dto';

export class PreGateLineDto {
  @IsString()
  @IsNotEmpty()
  containerNumber: string;

  @IsString()
  isoTypeCode: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(45)
  sizeFt?: number;

  @IsOptional()
  @IsEnum(ContainerType)
  containerType?: ContainerType;

  @IsOptional()
  @IsNumber()
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;

  @IsOptional()
  @IsBoolean()
  customsHold?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePreGateDto {
  @IsString()
  @IsNotEmpty()
  yardId: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsString()
  @IsNotEmpty()
  voyageCode: string;

  @IsOptional()
  @IsString()
  vesselName?: string;

  @IsOptionalDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  transportMode?: TransportMode;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentTermDto)
  paymentTerm?: PaymentTermDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreGateLineDto)
  lines: PreGateLineDto[];
}
