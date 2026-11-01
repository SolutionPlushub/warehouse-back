/** Seuils de séjour du camion de reprise (attente douane), en heures. */
export const PICKUP_WAIT_WARN_HOURS = 24;
export const PICKUP_WAIT_ALERT_HOURS = 40;
/** Franchise avant facturation détention (heures). */
export const PICKUP_DETENTION_FREE_HOURS = 24;

export function pickupWaitHours(loadedAt: Date, until: Date = new Date()): number {
  return Math.max(0, (until.getTime() - loadedAt.getTime()) / 3_600_000);
}

export function pickupWaitBand(
  hours: number,
): 'ok' | 'warn' | 'alert' {
  if (hours >= PICKUP_WAIT_ALERT_HOURS) return 'alert';
  if (hours >= PICKUP_WAIT_WARN_HOURS) return 'warn';
  return 'ok';
}

/**
 * Jours de surestarie : par tranche de 24 h entamée au-delà de la franchise
 * (franchise propre au client — Tenant.truckFreetimeHours — sinon 24 h).
 */
export function pickupDetentionDays(
  hours: number,
  freeHours: number | null = PICKUP_DETENTION_FREE_HOURS,
): number {
  const free = freeHours ?? PICKUP_DETENTION_FREE_HOURS;
  return Math.ceil(Math.max(0, hours - free) / 24);
}
