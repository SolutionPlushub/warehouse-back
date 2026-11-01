import { IsBoolean } from 'class-validator';

// Bascule "contrôlé/fourni" d'une pièce de la checklist documentaire
// (Étape 6 — Contrôle documentaire, §5). Voir ShipmentFileDocument.
export class ToggleDocumentDto {
  @IsBoolean()
  attached: boolean;
}
