import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContainerType } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';
import { PaymentTermDto } from '../../payments/dto/payment-term.dto';

export class GateInDto {
  @IsString()
  @IsNotEmpty()
  containerNumber: string;

  @IsString()
  @IsNotEmpty()
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
  @Min(0)
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsString()
  voyageCode?: string;

  @IsOptional()
  @IsBoolean()
  customsHold?: boolean;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  @IsOptionalDateString()
  gateInDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Client propriétaire de la marchandise (Tenant type=CLIENT)
  @IsOptional()
  @IsString()
  clientId?: string;

  // Yard cible (si null, déduit depuis la position allouée)
  @IsOptional()
  @IsString()
  yardId?: string;

  // Optionnel : forcer une position spécifique (sinon auto-allocation)
  @IsOptional()
  @IsString()
  forcedPositionId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentTermDto)
  paymentTerm?: PaymentTermDto;
}
