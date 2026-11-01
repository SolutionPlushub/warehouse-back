import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Vue façade en lecture seule : agrège ShipmentLine (colis WMS) et
// YardContainer (conteneurs YMS) d'un dossier en une liste unique
// normalisée — miroir de `d.lines[]` côté frontend (dos-store.js), qui ne
// distingue pas les deux au niveau de l'écran Cargaison. Read-only : les
// mutations continuent de passer par wms.service.ts / yms.service.ts, qui
// restent la source de vérité de chaque modèle.
export interface CargoUnit {
  id: string;
  kind: 'CONTAINER' | 'PACKAGE';
  status: string;
  // Champs communs approximatifs
  ref: string; // packageRef (colis) ou containerNumber (conteneur)
  weightKg: number | null;
  // Spécifique conteneur
  iso?: string;
  size?: number;
  seal?: string;
  // Spécifique colis
  packageType?: string;
  quantity?: number;
  volumeM3?: number | null;
  surfaceM2?: number | null;
}

@Injectable()
export class CargoService {
  constructor(private readonly prisma: PrismaService) {}

  async listUnits(fileId: string, tenantId: string): Promise<CargoUnit[]> {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    const [lines, operationLines] = await Promise.all([
      this.prisma.shipmentLine.findMany({
        where: { shipmentFileId: fileId, tenantId },
        include: { packageType: { select: { label: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.operationLine.findMany({
        where: { operation: { shipmentFileId: fileId, tenantId } },
        include: { yardContainer: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const packages: CargoUnit[] = lines.map((l) => ({
      id: l.id,
      kind: 'PACKAGE',
      status: l.status,
      ref: l.packageRef,
      weightKg: l.weightKg,
      packageType: l.packageType.label,
      quantity: l.quantity,
      volumeM3: l.volumeM3,
      surfaceM2: l.surfaceM2,
    }));

    // Un même conteneur peut apparaître sur plusieurs OperationLine (une
    // par opération du dossier qui le concerne) — dédoublonné par id.
    const containersById = new Map<string, CargoUnit>();
    for (const ol of operationLines) {
      const c = ol.yardContainer;
      if (!c || containersById.has(c.id)) continue;
      containersById.set(c.id, {
        id: c.id,
        kind: 'CONTAINER',
        status: c.status,
        ref: c.containerNumber,
        weightKg: c.grossWeightKg,
        iso: c.isoTypeCode,
        size: c.sizeFt,
        seal: c.sealNumber ?? undefined,
      });
    }

    return [...containersById.values(), ...packages];
  }
}
