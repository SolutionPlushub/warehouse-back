import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ShipmentFileStatus } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class UpdateShipmentFileDto {
  @IsOptional()
  @IsString()
  voyageCode?: string;

  @IsOptional()
  @IsString()
  shipmentTypeCode?: string;

  @IsOptional()
  @IsString()
  storageRegimeCode?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientRef?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  transportDocNumber?: string;

  @IsOptional()
  @IsString()
  customsDeclNumber?: string;

  @IsOptionalDateString()
  customsDeclDate?: string;

  @IsOptionalDateString()
  eta?: string;

  @IsOptionalDateString()
  entryDate?: string;

  @IsOptional()
  @IsEnum(ShipmentFileStatus)
  status?: ShipmentFileStatus;

  @IsOptional()
  @IsString()
  defaultYardId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  vatApplicable?: boolean;
}
