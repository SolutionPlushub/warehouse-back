/**
 * Résolution des charges d'un dossier DIRECTEMENT depuis la grille tarifaire
 * (TariffRef) — un tarif marqué « Obligatoire » et applicable à une opération
 * du dossier est automatiquement porté en finance.
 *
 * Avant, la résolution passait uniquement par le catalogue intermédiaire
 * InducedServiceRef + OperationInducedRule, alimenté par le seed initial et
 * jamais par la grille réelle : en base, aucune règle → aucune charge (ou des
 * lignes à 0 FCFA), alors que la grille DMT 2026 porte déjà les opérations
 * concernées par chaque tarif.
 *
 * Les variantes d'un même service sont départagées à partir de la grille :
 *   - taille : libellé « 20' » / « 40' » → conteneurs de cette taille ;
 *   - vide / plein : libellé « vide » / « plein » → conteneurs vides / pleins ;
 *   - journalier / mensuel : unité « ·jour » / « ·mois » → selon le moteur
 *     de séjour (bascule mensuelle au-delà du seuil du tenant) ;
 *   - transit / local et entrepôt fictif : départagés par le régime douanier
 *     quand la grille propose les deux variantes pour la même opération.
 * Fonction pure : réutilisée par la résolution d'un dossier existant et par
 * l'aperçu du wizard de création (même calcul des deux côtés).
 */

export interface GridTariff {
  id: string;
  code: string;
  label: string;
  unit: string;
  rate: number;
  applicableOps: string[];
  mandatory: boolean;
}

export interface GridContainer {
  sizeFt: number | null;
  containerType: string | null;
}

export interface GridContext {
  operationTypes: string[];
  containers: GridContainer[];
  regimeCode?: string | null;
  // Jours de séjour (estimés à la création, réels au Gate Out) et franchise.
  days: number;
  freetime: number;
  monthlyTier: boolean;
  monthlyQty: number;
  truckCount: number;
  surfaceM2: number;
  weightKg: number;
  pickupWaitDays: number;
}

export interface GridLine {
  tariffId: string;
  label: string;
  unit: string;
  quantity: number;
  rate: number;
  ruleLabel: string;
}

const lower = (s: string) => (s || '').toLowerCase();
const sizeOf = (t: GridTariff): 20 | 40 | null =>
  /\b40'/.test(t.label) ? 40 : /\b20'/.test(t.label) ? 20 : null;
const isEmptyOnly = (t: GridTariff) => /\bvide\b/.test(lower(t.label));
const isFullOnly = (t: GridTariff) => /\bplein\b/.test(lower(t.label));
const isDetention = (t: GridTariff) => /camion\s*·\s*jour/.test(lower(t.unit));
const period = (t: GridTariff): 'day' | 'month' | null =>
  isDetention(t)
    ? null
    : /·\s*jour|\/\s*jour/.test(lower(t.unit))
      ? 'day'
      : /·\s*mois|\/\s*mois/.test(lower(t.unit))
        ? 'month'
        : null;
const isTransit = (t: GridTariff) =>
  /entrepôt transit|\(transit\)|en transit/.test(lower(t.label));
const isLocal = (t: GridTariff) => /\blocal\b/.test(lower(t.label));
const isFictif = (t: GridTariff) => /fictif/.test(lower(t.label));

const REGIME_TRANSIT = 'TRANSIT';
const REGIME_FICTIF = 'ENTREPOT_FICTIF';

export function resolveFromGrid(
  tariffs: GridTariff[],
  ctx: GridContext,
): GridLine[] {
  const out = new Map<string, GridLine>();
  const billableDays = Math.max(0, ctx.days - ctx.freetime);

  for (const op of ctx.operationTypes) {
    let candidates = tariffs.filter(
      (t) =>
        t.mandatory &&
        (t.applicableOps.length === 0 || t.applicableOps.includes(op)),
    );

    // Transit / local : seulement si la grille propose les deux pour l'op.
    if (candidates.some(isTransit) && candidates.some(isLocal)) {
      const transit = ctx.regimeCode === REGIME_TRANSIT;
      candidates = candidates.filter((t) =>
        isTransit(t) ? transit : isLocal(t) ? !transit : true,
      );
    }
    // Entrepôt fictif / classique : variantes de stockage selon le régime.
    if (candidates.some((t) => isFictif(t) && period(t))) {
      const fictif = ctx.regimeCode === REGIME_FICTIF;
      candidates = candidates.filter((t) =>
        !period(t) ? true : isFictif(t) ? fictif : !fictif,
      );
    }
    // Journalier / mensuel : selon le moteur de séjour, si les deux existent.
    if (
      candidates.some((t) => period(t) === 'day') &&
      candidates.some((t) => period(t) === 'month')
    ) {
      candidates = candidates.filter((t) =>
        period(t) === 'month' ? ctx.monthlyTier : period(t) === 'day' ? !ctx.monthlyTier : true,
      );
    }

    for (const t of candidates) {
      if (out.has(t.id)) continue;
      const u = lower(t.unit);
      if (u.includes('%')) continue; // majoration : appliquée manuellement

      // Conteneurs concernés par ce tarif (taille, vide/plein).
      const size = sizeOf(t);
      const units = ctx.containers.filter((c) => {
        const sz = c.sizeFt ?? 20;
        if (size === 20 && sz !== 20) return false;
        if (size === 40 && sz < 40) return false;
        const empty = c.containerType === 'EMPTY';
        if (isEmptyOnly(t) && !empty) return false;
        if (isFullOnly(t) && empty) return false;
        return true;
      });
      const perContainer = size != null || isEmptyOnly(t) || isFullOnly(t);
      if (perContainer && !units.length) continue;

      let base: number;
      if (isDetention(t)) base = ctx.pickupWaitDays;
      else if (/evp/.test(u))
        base = units.reduce((s, c) => s + ((c.sizeFt ?? 20) >= 40 ? 2 : 1), 0);
      else if (/conteneur|^20'|^40'/.test(u)) base = units.length;
      else if (/camion/.test(u)) base = Math.max(1, ctx.truckCount);
      else if (/m²|m2/.test(u)) base = ctx.surfaceM2;
      else if (/tonne/.test(u)) base = Math.max(0.1, ctx.weightKg / 1000);
      else base = 1;

      const p = period(t);
      const quantity =
        p === 'day' ? base * billableDays : p === 'month' ? base * ctx.monthlyQty : base;
      // Les charges de séjour restent visibles à 0 tant que la durée n'est
      // pas connue (recalculées au Gate Out) ; les autres lignes à 0 sont
      // sans objet (ex. pas de surface saisie, pas de détention).
      if (!(quantity > 0) && !(p && base > 0)) continue;

      out.set(t.id, {
        tariffId: t.id,
        label: t.label,
        unit: t.unit,
        quantity: Math.round(quantity * 100) / 100,
        rate: t.rate,
        ruleLabel: `GRID:${op}`,
      });
    }
  }
  return [...out.values()];
}
