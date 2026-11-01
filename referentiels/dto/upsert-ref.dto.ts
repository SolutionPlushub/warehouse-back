import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  IsHexColor,
  Min,
  IsArray,
  ValidateNested,
  IsIn,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OperationType } from '@prisma/client';
import { PolygonPointDto } from '../../yms/dto/create-yard-block-def.dto';
import { ArrayMinSize } from 'class-validator';

// ── FieldRule : définit un champ du formulaire dossier ──────────────────────
export class FieldRuleDto {
  @IsString() @IsNotEmpty() field: string;
  @IsString() @IsNotEmpty() label: string;
  @IsBoolean() required: boolean;
  @IsOptional() @IsString() section?: string;
}

// ── DocumentRule : définit un document requis ────────────────────────────────
export class DocumentRuleDto {
  @IsString() @IsNotEmpty() type: string;
  @IsString() @IsNotEmpty() label: string;
  @IsIn(['entry', 'exit', 'both']) phase: 'entry' | 'exit' | 'both';
  @IsBoolean() uploadRequired: boolean;
  @IsBoolean() mailAllowed: boolean;
}

export class UpsertStorageRegimeDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsString() labelShort?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsHexColor() bg?: string;
  @IsOptional() @IsInt() @Min(0) sommierDays?: number;
  @IsOptional() @IsInt() @Min(0) sommierExtensionDays?: number;
  @IsOptional() @IsInt() @Min(0) sommierMaxExtensions?: number;
  // Seuils d'alerte sommier (jours avant expiry), ex: [30, 7, 0]
  @IsOptional() @IsArray() @IsInt({ each: true }) alertThresholds?: number[];
  // Champs dynamiques formulaire entrée
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldRuleDto)
  entryFieldConfig?: FieldRuleDto[];
  // Champs dynamiques formulaire sortie
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldRuleDto)
  exitFieldConfig?: FieldRuleDto[];
  // Documents requis (upload / mail)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DocumentRuleDto)
  documentConfig?: DocumentRuleDto[];
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpsertShipmentTypeDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpsertPackageTypeDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() label: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpsertStorageZoneDto {
  @IsOptional() @IsString() code?: string;
  // Code actuel, envoyé à la modification pour renommer la zone sans en créer une autre.
  @IsOptional() @IsString() previousCode?: string;
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsNotEmpty() yardId: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) surfaceM2?: number;
  @IsOptional() @IsInt() @Min(0) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  // Tracé de la zone à l'intérieur du périmètre du yard (Yard.perimeter) —
  // même format que YardBlockDef.polygon. Optionnel — zone sans tracé.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => PolygonPointDto)
  polygon?: PolygonPointDto[];
}

// Transporteur — créable à la volée depuis le Gate, pas de code (juste un
// nom), miroir de DosConfig.addCarrier() côté frontend.
export class UpsertCarrierDto {
  @IsString() @IsNotEmpty() name: string;
}

// Engin de manutention (reachstacker, chariot élévateur…) — CRUD Paramétrage
// DOS, même forme que Transporteur. Miroir de DosConfig.addEquipment().
export class UpsertEquipmentDto {
  @IsString() @IsNotEmpty() name: string;
}

// Grille tarifaire — miroir de DOS_TARIFFS/DOS_SERVICES + DosConfig
// addTariff()/updateTariff() côté frontend (lib/data/data-dos.js,
// lib/stores/dos-config-store.js). `applicableOps` vide = applicable à
// toutes les opérations (équivalent du marqueur '*' du mock).
export class CreateTariffDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() domain: string;
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsNotEmpty() unit: string;
  @IsInt() @Min(0) rate: number;
  @IsOptional()
  @IsArray()
  @IsEnum(OperationType, { each: true })
  applicableOps?: OperationType[];
  // Indépendant de OperationInducedRule.mandatory (règle opération→
  // prestation induite) — sert de valeur par défaut quand ce tarif est
  // ajouté manuellement à un dossier (AddServiceModal, dossier-finance.jsx).
  @IsOptional() @IsBoolean() mandatory?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateTariffDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) rate?: number;
  @IsOptional()
  @IsArray()
  @IsEnum(OperationType, { each: true })
  applicableOps?: OperationType[];
  @IsOptional() @IsBoolean() mandatory?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
