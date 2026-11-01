import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayNotEmpty } from 'class-validator';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';

// Réception simultanée de plusieurs lignes d'un même pré-gate — sur le
// modèle de ReceiveShipmentDto (WMS), qui traite déjà plusieurs lignes en
// une seule requête/transaction.
export class GateInBulkFromPreGateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  preGateLineIds: string[];

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
