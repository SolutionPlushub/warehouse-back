import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  InlineGateInLineDto,
  InlineShipmentLineDto,
} from './create-shipment-file.dto';

// Ajout de cargaison (conteneurs ou colis) sur un dossier EXISTANT — rattrape
// le cas d'un dossier créé sans cargaison (mise à zéro, saisie incomplète du
// wizard…). Mêmes formes que CreateShipmentFileDto.containers/.lines. Refusé
// par WmsService.addCargo() si l'opération initiale a déjà un Bon à Entrer
// émis ou qu'au moins une de ses lignes est engagée (inspection/emplacement)
// — voir le commentaire de la méthode pour le détail de la garde.
export class AddCargoDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InlineGateInLineDto)
  containers?: InlineGateInLineDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InlineShipmentLineDto)
  lines?: InlineShipmentLineDto[];
}
