import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsNumber,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OperationType, ContainerType } from '@prisma/client';
import { IsOptionalDateString } from '../../common/decorators/is-optional-date-string.decorator';
import { PaymentTermDto } from '../../payments/dto/payment-term.dto';

// Conteneur à créer (gate-in) "inline" à la création du dossier — même forme
// que GateInDto, moins le tenant/l'opérateur qui viennent du contexte de la
// requête. Utilisé par ICD_FULL/ICD_EMPTY/DEP_TRANS/DEP_STOCK/EMP_EXPORT
// (cargaison CT) — voir CreateShipmentFileDto.containers.
export class InlineGateInLineDto {
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
  @IsNumber()
  @Min(0)
  grossWeightKg?: number;

  @IsOptional()
  @IsString()
  shippingLine?: string;

  @IsOptional()
  @IsBoolean()
  customsHold?: boolean;

  @IsOptional()
  @IsBoolean()
  isDangerousGoods?: boolean;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  // BL / document de transport associé à ce conteneur (saisi côté wizard
  // frontend par ligne CT — voir dossier-create.jsx `l.bl`). Pas de colonne
  // dédiée sur YardContainer : conservé en notes pour ne pas perdre l'info,
  // le document de transport du dossier reste porté par ShipmentFile.
  @IsOptional()
  @IsString()
  bl?: string;

  // Nature de la cargaison (Vrac/Conventionnel) — pertinente uniquement pour
  // les OperationLine de type DEP_TRANS/DEP_STOCK/EMP_EXPORT (règle §5 Note
  // logique de service), reportée telle quelle sur OperationLine.cargoNature.
  @IsOptional()
  @IsString()
  cargoNature?: string;

  // Nombre de colis attendus dans ce conteneur (pointage contradictoire,
  // rapport de dépotage, chargements camions).
  @IsOptional()
  @IsInt()
  @Min(0)
  packageCount?: number;
}

// Ligne de marchandise (colis/palette…) à créer "inline" à la création du
// dossier — même forme que CreateShipmentLineDto. Utilisé par ENT_IN
// (cargaison CV) — voir CreateShipmentFileDto.lines.
export class InlineShipmentLineDto {
  @IsString()
  @IsNotEmpty()
  packageRef: string;

  @IsOptional()
  @IsString()
  packageTypeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  packageCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  volumeM3?: number;

  @IsOptional()
  @IsNumber()
  surfaceM2?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  yardId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;
}

// Ligne de facturation (prestation induite déjà résolue côté frontend, ou
// ligne ajoutée manuellement depuis la grille tarifaire) à créer "inline" à
// la création du dossier — voir CreateShipmentFileDto.serviceLines. Miroir
// de fLines (StepFinance, dossier-create.jsx) : le frontend a déjà résolu
// serviceId/tariffId/label/unit/qty/rate via resolveInducedServices(), donc
// pas de re-résolution serveur ici — juste persistance verbatim en
// ShipmentFileServiceLine (inducedServiceId non retenu : catalogue frontend
// IS-xx, pas un InducedServiceRef réel — mêmes contraintes que
// AddManualServiceLineDto, tariffId excepté qui référence un TariffRef réel).
export class InlineServiceLineDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsString()
  tariffId?: string;

  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @IsOptional()
  @IsString()
  ruleLabel?: string;
}

export class CreateShipmentFileDto {
  @IsString()
  @IsNotEmpty()
  voyageCode: string;

  @IsString()
  @IsNotEmpty()
  shipmentTypeCode: string;

  @IsString()
  @IsNotEmpty()
  storageRegimeCode: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientRef?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  transportDocNumber?: string;

  @IsOptional()
  @IsString()
  customsDeclNumber?: string;

  @IsOptionalDateString()
  customsDeclDate?: string;

  @IsOptionalDateString()
  eta?: string;

  @IsOptionalDateString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  defaultYardId?: string;

  // Choix "Assujetti TVA" fait à l'étape Finance de la création (StepFinance,
  // dossier-create.jsx) — repris par défaut à l'émission de facture.
  @IsOptional()
  @IsBoolean()
  vatApplicable?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  // Dossier créé depuis un conteneur en yard (dépotage) — marque le
  // conteneur comme en cours de dépotage.
  @IsOptional()
  @IsString()
  yardContainerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentTermDto)
  paymentTerm?: PaymentTermDto;

  // Type d'opération à démarrer avec ce dossier (voir claude.md, OPÉRATIONS
  // ET PIPELINE). DÉPRÉCIÉ au profit de `operationTypes` (pluriel) qui
  // permet de sélectionner plusieurs types en une seule création (le wizard
  // frontend dossier-create.jsx autorise le multi-sélection d'opérations
  // avec une cargaison PARTAGÉE — voir `containers`/`lines` ci-dessous).
  // Conservé pour compat ascendante : si fourni seul (sans operationTypes),
  // il est traité comme `operationTypes: [operationType]`.
  @IsOptional()
  @IsEnum(OperationType)
  operationType?: OperationType;

  // Types d'opération à démarrer avec ce dossier, en une seule création
  // atomique. Miroir de `ops` (tableau) côté wizard frontend
  // (dossier-create.jsx step 1) — plusieurs types peuvent partager la même
  // cargaison `containers`/`lines` ci-dessous (ex: DEP_STOCK crée un
  // conteneur qui devient son INPUT ; ICD_FULL sélectionné en même temps
  // créerait ses propres conteneurs OUTPUT dans le même lot `containers`).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(OperationType, { each: true })
  operationTypes?: OperationType[];

  // Conteneurs à créer (gate-in) dans la même transaction que le dossier —
  // cargaison CT partagée par tous les `operationTypes` sélectionnés qui en
  // ont besoin (ICD_FULL, ICD_EMPTY, DEP_TRANS, DEP_STOCK, EMP_EXPORT — ce
  // dernier au sens "conteneur vide reçu pour empotage", voir
  // WmsService.createFile() pour le détail du rôle attribué par type).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InlineGateInLineDto)
  containers?: InlineGateInLineDto[];

  // Lignes de marchandise (colis) à créer dans la même transaction que le
  // dossier — cargaison CV, utilisée par ENT_IN.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InlineShipmentLineDto)
  lines?: InlineShipmentLineDto[];

  // Noms des pièces requises pour ce dossier (référentiel statique frontend
  // OP_TYPES[type].docs, dos-data.js — voir ShipmentFileDocument) : créées
  // non-contrôlées (attached=false) dans la même transaction, pour que la
  // checklist Étape 6 soit prête dès l'ouverture du dossier.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentNames?: string[];

  // Lignes de facturation (StepFinance, dossier-create.jsx) résolues côté
  // frontend avant soumission — créées telles quelles dans la même
  // transaction que le dossier (voir InlineServiceLineDto).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InlineServiceLineDto)
  serviceLines?: InlineServiceLineDto[];
}
