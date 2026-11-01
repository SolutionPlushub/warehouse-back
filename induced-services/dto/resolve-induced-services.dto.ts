import { IsInt, IsOptional, Min } from 'class-validator';

export class ResolveInducedServicesDto {
  // Durée de séjour prévue (jours) — sert à évaluer la règle OVER_FRANCHISE
  // (magasinage au-delà de la franchise contractuelle).
  @IsOptional()
  @IsInt()
  @Min(0)
  days?: number;

  // Franchise contractuelle du client (jours). Pas encore de champ dédié
  // sur Tenant/client — transmis explicitement par l'appelant, comme côté
  // frontend (dclient(client).freetime), en attendant un modèle de contrat
  // client plus riche.
  @IsOptional()
  @IsInt()
  @Min(0)
  freetime?: number;

  // Jours de détention camion de reprise (au-delà de 24h d'attente douane).
  @IsOptional()
  @IsInt()
  @Min(0)
  pickupWaitDays?: number;
}
