import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ArrayNotEmpty,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContainerType, HandlingCrewType } from '@prisma/client';
import { CapacitySlotDto } from './capacity-reservation.dto';

// kind='reserve' — réservation/réception d'un conteneur vide (étape 2 du
// pipeline EMP_EXPORT) : ce conteneur n'existe pas encore en base à cet
// instant, contrairement aux autres `kind` qui font toujours avancer des
// OperationLine déjà existantes — voir OperationsService.advance().
export class ReserveEmptyContainerDto {
  @IsString()
  @IsNotEmpty()
  containerNumber: string;

  @IsString()
  @IsNotEmpty()
  isoTypeCode: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(45)
  sizeFt?: number;

  @IsOptional()
  @IsEnum(ContainerType)
  containerType?: ContainerType;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;
}

// kind='seal' — contrôle du plomb relevé pour UN conteneur du périmètre
// (une entrée par OperationLine, jamais une valeur globale — chaque
// conteneur a son propre n° de plomb attendu, voir YardContainer.sealNumber).
export class SealCheckDto {
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  @IsString()
  @IsNotEmpty()
  sealRead: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsOptional()
  @IsString()
  witness?: string;
}

// kind='tally' — quantité RÉELLEMENT constatée pour UNE OperationLine du
// périmètre (une entrée par ligne — pas de valeur globale) ; l'écart se
// calcule côté serveur en comparant à ShipmentLine.quantity (la quantité
// attendue, déjà connue, jamais dupliquée).
export class TallyCheckDto {
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  @IsInt()
  counted: number;
}

// Pointage par référence de colis (dépotage) : quantité constatée pour une
// ShipmentLine du dossier.
export class PackageTallyDto {
  @IsString()
  @IsNotEmpty()
  shipmentLineId: string;

  @IsInt()
  @Min(0)
  counted: number;
}

// kind='quality' — résultat du contrôle qualité/quantité pour UNE
// OperationLine du périmètre (une entrée par unité, jamais un résultat
// global — chaque conteneur/colis peut avoir un état différent).
export class QualityCheckDto {
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  @IsString()
  @IsNotEmpty()
  result: string;

  @IsOptional()
  @IsString()
  nc?: string;
}

// kind='doc' — document émis pour UNE OperationLine du périmètre (une
// entrée par unité, comme SealCheckDto — chaque conteneur/colis peut être
// couvert par un document distinct).
export class DocCheckDto {
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  @IsString()
  @IsNotEmpty()
  docNumber: string;

  @IsString()
  @IsNotEmpty()
  sentTo: string;
}

// kind='report' — rapport contradictoire pour UNE OperationLine du
// périmètre. `received` réutilise le même principe que TallyCheckDto
// (attendu = ShipmentLine.quantity, jamais dupliqué), mais reste un champ
// distinct de OperationLine.quantity (le pointage de picking) puisqu'un
// rapport de dépotage/empotage est un contrôle contradictoire séparé.
export class ReportCheckDto {
  @IsString()
  @IsNotEmpty()
  operationLineId: string;

  @IsString()
  @IsNotEmpty()
  reportNumber: string;

  @IsInt()
  received: number;

  @IsString()
  @IsNotEmpty()
  signDmt: string;

  @IsString()
  @IsNotEmpty()
  signThird: string;
}

// kind='gateout' — chauffeur/destination au moment de la sortie réelle
// (truckPlate/truckCarrier déjà posés à l'étape "Gate In véhicule", voir
// loadplan ci-dessous) — une valeur PARTAGÉE par tout le périmètre de
// l'étape (un seul véhicule qui repart avec plusieurs unités), contrairement
// à seal/quality/tally qui sont par unité.
export class LoadPlanTruckDto {
  @IsString()
  @IsNotEmpty()
  plate: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  driver?: string;

  @IsOptional()
  @IsString()
  cin?: string;

  @IsOptional()
  @IsString()
  permit?: string;

  @IsArray()
  @IsString({ each: true })
  units: string[];

  // true = camion de reprise (Chargement camion / transbordement).
  // false/absent = rattachement Gate In (ne pas écraser un pickup déjà posé).
  @IsOptional()
  @IsBoolean()
  pickup?: boolean;
}

export class GateOutInfoDto {
  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsString()
  @IsNotEmpty()
  driver: string;

  @IsOptional()
  @IsString()
  cin?: string;

  @IsOptional()
  @IsString()
  permit?: string;

  @IsOptional()
  @IsString()
  destination?: string;
}

// Équipe de manutention d'une étape (déchargement, dépotage, empotage) :
// dockers → nombre obligatoire ; manœuvres externes → pas de nombre.
export class HandlingCrewDto {
  @IsEnum(HandlingCrewType)
  type: HandlingCrewType;

  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;
}

// kind='whreception' (DEP_STOCK « Création réception entrepôt ») — entrepôt
// et zone RÉELS (Yard type WAREHOUSE/BONDED_WAREHOUSE + StorageZone créés
// dans Paramétrage), surface occupée par la marchandise dépotée.
export class WarehouseReceptionDto {
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  zoneId: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  surfaceM2?: number;
}

// Payload d'effets de bord métier appliqués par advance() selon `kind` —
// miroir de `payload.data` côté frontend (dos-store.js executeOpStep()).
// Toutes les clés sont optionnelles ; seules celles pertinentes au `kind`
// envoyé sont interprétées par OperationsService.advance().
export class AdvanceOperationDataDto {
  // kind='slot'|'placement' — emplacement affecté par unité du périmètre.
  @ApiPropertyOptional({ type: [CapacitySlotDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapacitySlotDto)
  slots?: CapacitySlotDto[];

  // Rattachement automatique de camion(s) aux lignes — typiquement à l'étape
  // "Gate In véhicule" d'une opération OUT. Un loadplan par camion, chacun
  // listant les OperationLine qu'il transporte.
  @ApiPropertyOptional({
    description:
      'Plan de chargement — camion(s) et unités. pickup=true : camion de reprise (indépendant du Gate In).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadPlanTruckDto)
  loadplan?: LoadPlanTruckDto[];

  // kind='sealing' — nouveau numéro de plomb apposé sur le conteneur.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  newSeal?: string;

  // kind='seal' — relevé du plomb par conteneur (une entrée par
  // OperationLine du périmètre, jamais une valeur unique pour tout le lot).
  @ApiPropertyOptional({ type: [SealCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SealCheckDto)
  seals?: SealCheckDto[];

  // kind='placement' — surcharge ponctuelle du nombre de jours de franchise
  // (freetime) par rapport à la valeur par défaut du client
  // (Tenant.defaultFreetimeDays). Miroir du paramètre freetime de
  // startStorageBilling() côté frontend (dos-store.js).
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  freetimeDaysOverride?: number;

  // kind='reserve' (EMP_EXPORT) — conteneur vide réservé, créé à cette
  // étape (n'existe pas encore en base, voir ReserveEmptyContainerDto).
  @ApiPropertyOptional({ type: ReserveEmptyContainerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReserveEmptyContainerDto)
  emptyContainer?: ReserveEmptyContainerDto;

  // kind='tally' — comptage contradictoire par ligne (déchargement, picking,
  // chargement, transbordement — voir stepKindOf() côté frontend).
  @ApiPropertyOptional({ type: [TallyCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TallyCheckDto)
  tally?: TallyCheckDto[];

  // Détail du pointage par référence de colis (en plus du total par unité).
  @ApiPropertyOptional({ type: [PackageTallyDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackageTallyDto)
  packageTally?: PackageTallyDto[];

  // kind='quality' — résultat du contrôle qualité par unité du périmètre.
  @ApiPropertyOptional({ type: [QualityCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QualityCheckDto)
  qualityChecks?: QualityCheckDto[];

  // kind='doc' — document émis par unité du périmètre.
  @ApiPropertyOptional({ type: [DocCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocCheckDto)
  docs?: DocCheckDto[];

  // kind='report' — rapport contradictoire par unité du périmètre.
  @ApiPropertyOptional({ type: [ReportCheckDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportCheckDto)
  reports?: ReportCheckDto[];

  // kind='gateout' — chauffeur/destination, partagés par tout le périmètre.
  @ApiPropertyOptional({ type: GateOutInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GateOutInfoDto)
  gateOut?: GateOutInfoDto;

  @ApiPropertyOptional({ type: WarehouseReceptionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WarehouseReceptionDto)
  warehouseReception?: WarehouseReceptionDto;

  // Engin de manutention (nom du référentiel HandlingEquipmentRef) — toute
  // étape qui le saisit (mise à terre, placement, déchargement…). Était
  // jusqu'ici supprimé silencieusement par le ValidationPipe (whitelist).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  equipment?: string;

  @ApiPropertyOptional({ type: HandlingCrewDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HandlingCrewDto)
  handlingCrew?: HandlingCrewDto;

  // kind='transship' avec chargements partiels : valide l'étape alors que
  // tout n'a pas été chargé (reste soldé : avarie, reliquat, refus…).
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  closeBalance?: boolean;
}

export class AdvanceOperationDto {
  // Sous-ensemble des OperationLine à faire avancer — toutes les lignes non
  // terminées de l'opération par défaut. Miroir de `payload.units` côté
  // frontend (dos-store.js executeOpStep()).
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  operationLineIds?: string[];

  // Nature de l'étape franchie — 'finance' et 'dex' déclenchent le gating
  // §15 avant la dernière étape d'une opération sortante (dir=OUT) ;
  // 'placement' démarre la facturation du séjour, 'gateout' la finalise,
  // 'billing' émet manuellement la facture ; toute autre valeur (ex:
  // 'confirm') est un franchissement neutre.
  @IsOptional()
  @IsString()
  kind?: string;

  // Étape à laquelle l'écran voyait les unités au moment de l'envoi : si
  // elles ont déjà avancé (envoi rejoué, relance après erreur réseau), le
  // serveur refuse au lieu de franchir l'étape SUIVANTE par erreur.
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedStepIdx?: number;

  // Date/heure réelle de réalisation de l'étape (défaut : maintenant).
  @ApiPropertyOptional({ example: '2026-10-16T08:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  performedAt?: string;

  // Effets de bord associés à `kind` — voir AdvanceOperationDataDto.
  @ApiPropertyOptional({ type: AdvanceOperationDataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdvanceOperationDataDto)
  data?: AdvanceOperationDataDto;
}
