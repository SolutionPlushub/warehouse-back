export type AuditClass = {
  action: string;
  label: string;
  field?: string;
  from?: string;
  to?: string;
};

type Params = Record<string, string | undefined>;

function asAuditText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function classifyMutation(
  method: string,
  path: string,
  params: Params,
  body: Record<string, unknown> | undefined,
): AuditClass | null {
  const p = path.split('?')[0].replace(/^\/api/, '');
  const m = method.toUpperCase();
  const kind = typeof body?.kind === 'string' ? body.kind : '';

  if (m === 'POST' && /\/wms\/shipments\/?$/.test(p))
    return { action: 'CREATE', label: 'Création du dossier' };

  if (m === 'DELETE' && /\/wms\/shipments\/[^/]+$/.test(p))
    return { action: 'DELETE', label: 'Suppression du dossier' };

  if (m === 'PATCH' && /\/wms\/shipments\/[^/]+$/.test(p))
    return { action: 'UPDATE', label: 'Modification du dossier' };

  if (/\/payment-method$/.test(p))
    return {
      action: 'PAYMENT_METHOD',
      label: 'Modification du moyen de paiement',
      field: 'moyen de paiement',
      to: asAuditText(body?.method),
    };

  if (/\/shipments\/[^/]+\/block$/.test(p))
    return {
      action: 'BLOCK',
      label: 'Blocage du dossier',
      field: 'motif',
      to: asAuditText(body?.reason),
    };

  if (/\/shipments\/[^/]+\/unblock$/.test(p))
    return { action: 'UNBLOCK', label: 'Déblocage du dossier' };

  if (/\/customs$/.test(p))
    return {
      action: 'CUSTOMS',
      label: 'Mise à jour douanière',
      field: 'déclaration',
      to: asAuditText(body?.customsDeclNumber),
    };

  if (/\/receive$/.test(p))
    return { action: 'RECEIVE', label: 'Réception marchandise' };

  if (/\/receipts\//.test(p) && m === 'DELETE')
    return { action: 'RECEIPT_CANCEL', label: 'Annulation de réception' };

  if (/\/putaway$/.test(p))
    return { action: 'PUTAWAY', label: 'Confirmation de mise en place' };

  if (/\/extend-sommier$/.test(p))
    return { action: 'SOMMIER_EXTEND', label: 'Prorogation du sommier' };

  if (/\/documents\/[^/]+\/upload$/.test(p))
    return {
      action: 'DOCUMENT_UPLOAD',
      label: 'Pièce jointe déposée',
      field: decodeURIComponent(params.name || ''),
      to: 'stockée dans Azure',
    };

  if (/\/documents\/[^/]+\/content$/.test(p) && m === 'GET')
    return {
      action: 'DOCUMENT_DOWNLOAD',
      label: 'Pièce jointe consultée',
      field: params.documentId || '',
      to: 'téléchargée',
    };

  if (/\/documents\/[^/]+$/.test(p) && m === 'DELETE')
    return {
      action: 'DOCUMENT_DELETE',
      label: 'Pièce jointe supprimée',
      field: params.documentId || lastSegment(p),
      to: 'supprimée du stockage Azure',
    };

  if (/\/documents\//.test(p))
    return {
      action: 'DOCUMENT',
      label: body?.attached === false
        ? 'Document décoché'
        : 'Contrôle documentaire',
      field: decodeURIComponent(params.name || lastSegment(p)),
      to: body?.attached === false ? 'non fourni' : 'contrôlé',
    };

  if (/\/cargo$/.test(p))
    return { action: 'CARGO', label: 'Ajout de cargaison' };

  if (/\/shipments\/[^/]+\/lines$/.test(p) && m === 'POST')
    return { action: 'LINE_ADD', label: 'Ajout d’une ligne de colis' };

  if (/\/shipments\/[^/]+\/lines\//.test(p) && m === 'PATCH')
    return { action: 'LINE_UPDATE', label: 'Modification d’une ligne de colis' };

  if (/\/shipments\/[^/]+\/lines\//.test(p) && m === 'DELETE')
    return { action: 'LINE_DELETE', label: 'Suppression d’une ligne de colis' };

  if (/\/operations\/submit$/.test(p))
    return { action: 'SUBMIT', label: 'Soumission pour validation N+1' };

  if (/\/operations\/?$/.test(p) && m === 'POST')
    return {
      action: 'OP_CREATE',
      label: 'Ajout d’une opération',
      field: 'type',
      to: asAuditText(body?.type),
    };

  if (/\/validate$/.test(p) && params.operationId)
    return {
      action: 'VALIDATE',
      label: 'Validation N+1',
      field: 'commentaire',
      to: asAuditText(body?.comment),
    };

  if (/\/reject$/.test(p) && params.operationId)
    return {
      action: 'REJECT',
      label: 'Rejet N+1',
      field: 'commentaire',
      to: asAuditText(body?.comment),
    };

  if (/\/reopen$/.test(p))
    return { action: 'REOPEN', label: 'Réouverture de l’opération' };

  if (/\/close$/.test(p))
    return { action: 'CLOSE', label: 'Clôture de l’opération' };

  if (/\/cargo\/containers\/[^/]+$/.test(p))
    return {
      action: 'CARGO_UPDATE',
      label: 'Correction de la cargaison',
      field: body?.containerNumber ? 'n° conteneur' : 'conteneur',
      to: asAuditText(body?.containerNumber) || asAuditText(body?.reason),
    };

  if (/\/truck-loads$/.test(p) && m === 'POST')
    return {
      action: 'TRUCK_LOAD',
      label: 'Chargement camion',
      field: 'immatriculation',
      to: asAuditText(body?.plate),
    };
  if (/\/truck-loads\/[^/]+\/gate-out$/.test(p))
    return { action: 'TRUCK_LOAD_GATE_OUT', label: 'Sortie du camion chargé' };
  if (/\/truck-loads\/[^/]+\/deliver$/.test(p))
    return { action: 'TRUCK_LOAD_DELIVERED', label: 'Livraison confirmée' };
  if (/\/transshipment\/receivers$/.test(p) && m === 'POST')
    return {
      action: 'TRANSSHIP_RECEIVER_IN',
      label: 'Gate In du camion vide récepteur',
      field: 'immatriculation',
      to: asAuditText(body?.plate),
    };
  if (/\/transshipment\/receivers\/[^/]+\/exit$/.test(p))
    return { action: 'TRANSSHIP_RECEIVER_OUT', label: 'Gate out du camion récepteur' };
  if (/\/transshipment\/carrier-exit$/.test(p))
    return { action: 'TRANSSHIP_CARRIER_OUT', label: 'Sortie porteur après dépotage' };
  if (/\/truck-loads\/[^/]+\/cancel$/.test(p))
    return { action: 'TRUCK_LOAD_CANCEL', label: 'Annulation du chargement camion' };

  if (/\/rewind$/.test(p))
    return {
      action: 'REWIND',
      label: 'Retour à l’étape précédente',
      field: 'motif',
      to: asAuditText(body?.reason),
    };

  if (/\/advance$/.test(p))
    return {
      action: 'ADVANCE',
      label: stepLabel(kind),
      field: kind || 'étape',
    };

  if (/\/capacity$/.test(p))
    return { action: 'CAPACITY', label: 'Réservation de capacité' };

  if (/\/entry-authorization$/.test(p))
    return { action: 'ENTRY_AUTH', label: 'Émission du Bon à Entrer' };

  if (/\/entry-pass\/email$/.test(p))
    return { action: 'ENTRY_PASS_EMAIL', label: 'Envoi du Bon à Entrer par e-mail' };

  if (/\/gate-in$/.test(p))
    return {
      action: 'GATE_IN',
      label: 'Gate In',
      field: 'immatriculation',
      to: asAuditText(body?.truckPlate) || asAuditText(body?.plate),
    };

  if (/\/gate-passes\//.test(p))
    return {
      action: 'GATE_IN_FIX',
      label: body?.arrivedOperationLineIds || body?.truckPlate
        ? 'Correction du passage Gate In'
        : 'Correction de la date de Gate In',
      field: body?.truckPlate ? 'camion' : 'date',
      to: asAuditText(body?.truckPlate) || asAuditText(body?.gateInAt),
    };

  if (/\/gate-out-date$/.test(p))
    return { action: 'GATE_OUT_FIX', label: 'Correction de la date de sortie', to: asAuditText(body?.gateOutAt) };

  if (/\/inspection\/photos$/.test(p))
    return {
      action: 'INSPECTION_PHOTO_UPLOAD',
      label: 'Photo d’inspection déposée',
      field: 'inspection',
      to: 'stockée dans Azure',
    };

  if (/\/inspection\/photos\/content$/.test(p) && m === 'GET')
    return {
      action: 'INSPECTION_PHOTO_VIEW',
      label: 'Photo d’inspection consultée',
      field: 'inspection',
      to: 'affichée',
    };

  if (/\/inspection$/.test(p))
    return { action: 'INSPECT', label: 'Inspection d’unité' };

  if (/\/slot-change-request$/.test(p))
    return { action: 'SLOT_REQUEST', label: 'Demande de changement d’emplacement' };

  if (/\/slot-change-approvals\//.test(p) || /\/slot-change/.test(p))
    return {
      action: 'SLOT_DECIDE',
      label: body?.approved === false
        ? 'Refus du changement d’emplacement'
        : 'Approbation du changement d’emplacement',
    };

  if (/\/operations\/[^/]+\/validate-dex$/.test(p))
    return { action: 'OP_DEX', label: 'Validation DEX de l’opération' };

  if (/\/invoice\/issue$/.test(p))
    return { action: 'INVOICE_ISSUE', label: 'Émission de facture' };

  if (/\/invoice\/reissue$/.test(p))
    return { action: 'INVOICE_REISSUE', label: 'Réémission de facture' };

  if (/\/invoice\/mark-paid$/.test(p))
    return { action: 'INVOICE_PAID', label: 'Facture marquée payée' };

  if (/\/invoice\/validate-dex$/.test(p))
    return { action: 'INVOICE_DEX', label: 'Validation DEX de la facture' };

  if (/\/invoice\/reject-dex$/.test(p))
    return { action: 'INVOICE_DEX_REJECT', label: 'Rejet DEX de la facture' };

  if (/\/induced-services\/resolve$/.test(p))
    return { action: 'SERVICES_RESOLVE', label: 'Recalcul des prestations induites' };

  if (/\/induced-services\/lines$/.test(p) && m === 'POST')
    return { action: 'SERVICE_ADD', label: 'Ajout d’une ligne de facturation' };

  if (/\/induced-services\/lines\//.test(p) && m === 'PATCH')
    return { action: 'SERVICE_UPDATE', label: 'Modification d’une ligne de facturation' };

  if (/\/induced-services\/lines\//.test(p) && m === 'DELETE')
    return { action: 'SERVICE_DELETE', label: 'Suppression d’une ligne de facturation' };

  if (/\/exit-movements$/.test(p) && m === 'POST')
    return { action: 'EXIT_CREATE', label: 'Création d’un ordre de sortie' };

  if (/\/exit-movements\/[^/]+\/confirm$/.test(p))
    return { action: 'EXIT_CONFIRM', label: 'Confirmation de l’ordre de sortie' };

  if (/\/exit-movements\/[^/]+\/gate-out$/.test(p))
    return { action: 'EXIT_GATE_OUT', label: 'Gate Out entrepôt' };

  if (/\/wms\/lines\//.test(p) && m === 'PATCH')
    return { action: 'LINE_UPDATE', label: 'Modification d’une ligne de colis' };

  if (/\/wms\/lines\//.test(p) && m === 'DELETE')
    return { action: 'LINE_DELETE', label: 'Suppression d’une ligne de colis' };

  if (/\/payments\/[^/]+\/validate$/.test(p))
    return { action: 'PAYMENT_VALIDATE', label: 'Validation du paiement' };

  if (/\/wms\/shipments\//.test(p) || /\/payments\//.test(p))
    return {
      action: m,
      label: genericLabel(m, p),
    };

  return null;
}

function lastSegment(path: string) {
  return decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
}

function genericLabel(method: string, path: string) {
  const leaf = lastSegment(path).replace(/-/g, ' ');
  if (method === 'POST') return `Création — ${leaf}`;
  if (method === 'DELETE') return `Suppression — ${leaf}`;
  return `Modification — ${leaf}`;
}

function stepLabel(kind: string) {
  const map: Record<string, string> = {
    loadplan: 'Chargement camion (Gate In)',
    transship: 'Chargement camion de reprise',
    gateout: 'Gate Out',
    placement: 'Mise en emplacement',
    slot: 'Affectation d’emplacement',
    seal: 'Contrôle de plomb',
    quality: 'Contrôle qualité',
    inspect: 'Inspection',
    docs: 'Contrôle documentaire opération',
    report: 'Rapport d’opération',
    grounding: 'Mise à terre',
    unload: 'Déchargement / dépotage',
    whreception: 'Création de la réception entrepôt',
  };
  return map[kind] || (kind ? `Avancement d’étape (${kind})` : 'Avancement d’étape');
}
