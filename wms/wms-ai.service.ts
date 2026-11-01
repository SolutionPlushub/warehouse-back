import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentLineDto } from './dto/create-shipment-line.dto';

@Injectable()
export class WmsAiService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 1. Bulk create lines ─────────────────────────────────────────────────

  async bulkCreateLines(
    fileId: string,
    tenantId: string,
    dtos: CreateShipmentLineDto[],
  ) {
    const file = await this.prisma.shipmentFile.findFirst({
      where: { id: fileId, tenantId },
    });
    if (!file) throw new NotFoundException('Dossier introuvable.');

    // createMany ne retourne pas les enregistrements — on fait un createMany puis findMany
    await this.prisma.shipmentLine.createMany({
      data: dtos.map((dto) => ({
        shipmentFileId: fileId,
        tenantId,
        packageRef: dto.packageRef,
        packageTypeCode: dto.packageTypeCode ?? 'OTHER',
        packageCount: dto.packageCount ?? null,
        quantity: dto.quantity ?? 1,
        weightKg: dto.weightKg ?? null,
        volumeM3: dto.volumeM3 ?? null,
        surfaceM2: dto.surfaceM2 ?? null,
        description: dto.description ?? null,
        yardId: dto.yardId ?? null,
        zoneId: dto.zoneId ?? null,
      })),
      skipDuplicates: true,
    });

    return { ok: true, count: dtos.length };
  }

  // ── 2. OCR BL/facture via Claude Haiku vision ────────────────────────────

  async ocrBL(fileBuffer: Buffer, mimeType: string, _tenantId: string) {
    // Anthropic accepte jusqu'a ~32 Mo en base64 pour les PDFs (soit ~24 Mo brut)
    const MAX_BYTES = 24 * 1024 * 1024;
    if (fileBuffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(fileBuffer.length / 1024 / 1024).toFixed(1)} Mo). ` +
        `Maximum : 24 Mo. Decoupez le PDF en plusieurs fichiers si necessaire.`,
      );
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const base64 = fileBuffer.toString('base64');
    const isPdf  = mimeType.includes('pdf');

    const docBlock: Anthropic.ContentBlockParam = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } } as Anthropic.ContentBlockParam
      : { type: 'image',    source: { type: 'base64', media_type: mimeType as 'image/jpeg'|'image/png'|'image/gif'|'image/webp', data: base64 } } as Anthropic.ContentBlockParam;

    const prompt: Anthropic.ContentBlockParam = {
      type: 'text',
      text: `Tu es un expert en logistique internationale. Analyse ce document (connaissement BL, facture commerciale ou liste de colisage).

Extrais TOUS les colis/marchandises. Retourne UNIQUEMENT un objet JSON valide, sans markdown ni commentaires :
{
  "voyageCode": "numero de voyage ou null",
  "shippingLine": "nom armateur ou null",
  "lines": [
    {
      "packageRef": "reference unique du colis/article",
      "packageTypeCode": "PALLET|BOX|WOODEN_BOX|CONTAINER|VEHICLE|OTHER",
      "quantity": 1,
      "weightKg": null,
      "volumeM3": null,
      "description": "description courte de la marchandise"
    }
  ]
}

Regles :
- Si plusieurs colis identiques (ex: "5 palettes de vis") cree une seule ligne avec quantity=5
- packageRef : utilise la reference du document, sinon genere PKG-001, PKG-002...
- Ne cree PAS de ligne pour les totaux, sous-totaux ou entetes de colonne
- Inclus TOUTES les lignes de marchandises, meme si le document en a beaucoup`,
    };

    let msg: Anthropic.Message;
    try {
      msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: [docBlock, prompt] }],
      });
    } catch (err: unknown) {
      const e = err as { status?: number; error?: { error?: { type?: string; message?: string } } };
      if (e?.status === 400 && e?.error?.error?.type === 'invalid_request_error') {
        const msg400 = e?.error?.error?.message ?? '';
        if (msg400.toLowerCase().includes('credit')) {
          throw new BadRequestException(
            'Solde API Anthropic insuffisant. Rechargez votre compte sur console.anthropic.com/settings/billing.',
          );
        }
      }
      if (e?.status === 401) {
        throw new BadRequestException('Cle API Anthropic invalide. Verifiez ANTHROPIC_API_KEY dans le fichier .env.');
      }
      throw new BadRequestException(
        `Erreur API Anthropic (${e?.status ?? '?'}). Reessayez dans quelques instants.`,
      );
    }

    const text = (msg.content[0] as Anthropic.TextBlock).text;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as unknown;
      throw new BadRequestException('Impossible de parser la reponse IA. Reessayez.');
    }
  }

  // ── 3. Analyse de stock et recommandations ───────────────────────────────

  async analyzeStock(tenantId: string) {
    const [files, lines, yards] = await Promise.all([
      this.prisma.shipmentFile.findMany({
        where: { tenantId },
        select: {
          id: true,
          voyageCode: true,
          status: true,
          storageRegimeCode: true,
          sommierExpiryDate: true,
          createdAt: true,
        },
        take: 200,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shipmentLine.findMany({
        where: { tenantId, status: { not: 'OUT' } },
        select: {
          weightKg: true,
          surfaceM2: true,
          volumeM3: true,
          status: true,
          yardId: true,
        },
        take: 500,
      }),
      this.prisma.yard.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true, surfaceM2: true },
      }),
    ]);

    const now = new Date();
    const ms7d = 7 * 24 * 60 * 60 * 1000;
    const ms30d = 30 * 24 * 60 * 60 * 1000;

    const sommierExpiring7d = files.filter(
      (f) =>
        f.sommierExpiryDate &&
        new Date(f.sommierExpiryDate) <= new Date(now.getTime() + ms7d),
    ).length;
    const sommierExpiring30d = files.filter(
      (f) =>
        f.sommierExpiryDate &&
        new Date(f.sommierExpiryDate) <= new Date(now.getTime() + ms30d),
    ).length;
    const inStock = files.filter(
      (f) => f.status === 'IN_STOCK' || f.status === 'PARTIAL_OUT',
    ).length;
    const totalSurface = lines.reduce((s, l) => s + (l.surfaceM2 ?? 0), 0);

    const context = JSON.stringify({
      totalDossiers: files.length,
      inStock,
      sommierExpiring7d,
      sommierExpiring30d,
      totalLines: lines.length,
      totalSurfaceM2: Math.round(totalSurface),
      yards: yards.map((y) => ({
        code: y.code,
        name: y.name,
        totalSurfaceM2: y.surfaceM2,
      })),
    });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `Tu es un expert en gestion d'entrepôt logistique. Analyse ces données de stock et génère un rapport concis avec des recommandations actionnables en français.

Données : ${context}

Génère un rapport structuré avec :
1. Résumé de l'état actuel (2-3 phrases)
2. Alertes critiques (sommiers, occupation)
3. Recommandations prioritaires (max 4 points)

Sois direct, professionnel, et utilise des chiffres. Format : texte structuré, pas de JSON.`,
          },
        ],
      });
    } catch (err: unknown) {
      const e = err as { status?: number; error?: { error?: { type?: string; message?: string } } };
      if (e?.status === 400 && (e?.error?.error?.message ?? '').toLowerCase().includes('credit')) {
        throw new BadRequestException(
          'Solde API Anthropic insuffisant. Rechargez votre compte sur console.anthropic.com/settings/billing.',
        );
      }
      throw new BadRequestException(
        `Erreur API Anthropic (${e?.status ?? '?'}). Reessayez dans quelques instants.`,
      );
    }

    return {
      analysis: (message.content[0] as Anthropic.TextBlock).text,
      stats: {
        inStock,
        sommierExpiring7d,
        sommierExpiring30d,
        totalLines: lines.length,
        totalSurfaceM2: Math.round(totalSurface),
      },
    };
  }

  // ── 4. Suggestions basées sur l'historique ───────────────────────────────

  async suggestLine(packageRef: string, tenantId: string) {
    const similar = await this.prisma.shipmentLine.findMany({
      where: {
        tenantId,
        packageRef: {
          contains: packageRef.slice(0, 4),
          mode: 'insensitive',
        },
      },
      select: {
        packageTypeCode: true,
        weightKg: true,
        volumeM3: true,
        surfaceM2: true,
        yardId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (!similar.length) return { suggestions: {} };

    // Calcule les moyennes et le type le plus fréquent
    const typeCount: Record<string, number> = {};
    let weightSum = 0,
      weightCount = 0,
      volSum = 0,
      volCount = 0;

    for (const s of similar) {
      if (s.packageTypeCode) {
        typeCount[s.packageTypeCode] =
          (typeCount[s.packageTypeCode] ?? 0) + 1;
      }
      if (s.weightKg) {
        weightSum += s.weightKg;
        weightCount++;
      }
      if (s.volumeM3) {
        volSum += s.volumeM3;
        volCount++;
      }
    }

    const bestType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];

    return {
      suggestions: {
        packageTypeCode: bestType
          ? {
              value: bestType[0],
              confidence: Math.round((bestType[1] / similar.length) * 100),
            }
          : null,
        weightKg: weightCount
          ? { value: Math.round(weightSum / weightCount) }
          : null,
        volumeM3: volCount
          ? { value: +(volSum / volCount).toFixed(2) }
          : null,
      },
      basedOn: similar.length,
    };
  }
}
