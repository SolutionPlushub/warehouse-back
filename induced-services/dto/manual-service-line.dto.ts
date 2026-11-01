import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// Ligne de facturation manuelle — miroir de addService() côté frontend
// (dos-store.js). Contrairement aux prestations induites résolues
// automatiquement, elle n'a pas de tariffId/inducedServiceId d'origine.
export class AddManualServiceLineDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  @Min(0.01)
  rate: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  quantity?: number;

  // Renseigné quand la ligne vient de la grille tarifaire (AddServiceModal,
  // dossier-finance.jsx) plutôt que d'une saisie "hors grille" — conserve le
  // lien vers le TariffRef réel pour cette ligne.
  @IsOptional()
  @IsString()
  tariffId?: string;
}

export class UpdateServiceLineDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsString()
  unit?: string;
}
