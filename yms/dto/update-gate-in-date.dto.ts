import { IsDateString } from 'class-validator';

// Correction de la date/heure réelle de Gate In d'un conteneur YMS autonome
// (gate-in direct via POST /yms/gate-in ou depuis un pré-gate, sans dossier
// WMS/GatePass associé) — miroir de UpdateGatePassDto côté WMS
// (operations/dto/update-gate-pass.dto.ts), même principe : seul
// l'horodatage est corrigible après coup.
export class UpdateGateInDateDto {
  @IsDateString()
  gateInAt: string;
}

// Correction de la date/heure réelle de sortie d'un conteneur sorti.
export class UpdateGateOutDateDto {
  @IsDateString()
  gateOutAt: string;
}
