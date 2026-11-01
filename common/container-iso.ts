/**
 * Taille / famille d'un conteneur déduites de son code de type ISO 6346
 * (22G1, 42G1, 45G1, L5G1…) ou d'un code usuel (20DV, 40DV, 40HC, 40FT, 20RF…).
 *
 * Le 1er caractère porte la longueur : 2 → 20', 4 → 40' (45… → 45'), L → 45'.
 * Quand le code l'indique, il PRIME sur une taille transmise ou stockée dans le
 * référentiel : un type créé à la volée (ex. « 40FT ») recevait la taille par
 * défaut 20', d'où des 40' comptés 1 EVP au lieu de 2.
 */
export function sizeFromIsoCode(code?: string | null): 20 | 40 | 45 | null {
  const c = (code ?? '').trim().toUpperCase();
  if (/^(45|L)/.test(c)) return 45;
  if (/^4/.test(c)) return 40;
  if (/^2/.test(c)) return 20;
  return null;
}

export const sizeForType = (
  code?: string | null,
  sizeFt?: number | null,
): number => sizeFromIsoCode(code) ?? sizeFt ?? 20;

export function familyFromIsoCode(code?: string | null): string | null {
  const c = (code ?? '').trim().toUpperCase();
  if (/RF|R[0-9]$|RH/.test(c.slice(2))) return 'reefer';
  if (/OT|U[0-9]$/.test(c.slice(2))) return 'open_top';
  if (/FR|P[0-9]$/.test(c.slice(2))) return 'flat_rack';
  if (/^[24L]/.test(c)) return 'dry';
  return null;
}
