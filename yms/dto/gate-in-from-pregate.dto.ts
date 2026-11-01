import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

export class GateInFromPreGateDto {
  @IsString()
  @IsNotEmpty()
  preGateLineId: string;

  @IsString()
  @IsNotEmpty()
  yardId: string;

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
  sealNumber?: string;

  @IsOptionalDateString()
  gateInDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Client propriétaire de la marchandise (Tenant type=CLIENT) — surcharge celui du pré-gate si fourni
  @IsOptional()
  @IsString()
  clientId?: string;
}
