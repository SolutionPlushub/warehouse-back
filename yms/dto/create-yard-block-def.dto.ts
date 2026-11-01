import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsArray,
  IsNumber,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// Point du tracé de polygone — en pourcentage (0-100, décimales admises
// pour la précision du tracé), pas en pixels. Voir Yard.perimeter et
// YardBlockDef.polygon dans schema.prisma.
export class PolygonPointDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  x: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y: number;
}

export class CreateYardBlockDefDto {
  @IsString()
  @IsNotEmpty()
  yardId: string;

  @IsString()
  @IsNotEmpty()
  code: string; // libre : "N1", "ZONE-A", "HANGAR-2"…

  @IsOptional()
  @IsString()
  label?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  bays: number;

  @IsInt()
  @Min(1)
  @Max(20)
  rows: number;

  @IsInt()
  @Min(1)
  @Max(10)
  tiers: number;

  @IsInt()
  @Min(1)
  @Max(10)
  maxTier: number;

  @IsOptional()
  @IsBoolean()
  allowDangerousGoods?: boolean;

  @IsOptional()
  @IsBoolean()
  allowReefer?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEmpty?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAllTypes?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // Tracé du bloc sur le plan du site — optionnel (yard sans plan image,
  // ou bloc défini sans tracé, ancien mode numérique uniquement).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => PolygonPointDto)
  polygon?: PolygonPointDto[];
}

export class UpdateYardBlockDefDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  label?: string;

  // Redimensionnement. Une valeur plus petite supprime les emplacements
  // au-delà, seulement s'ils ne portent plus de conteneur. Une valeur plus
  // grande génère les positions manquantes.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  bays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  rows?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  tiers?: number;

  @IsOptional()
  @IsBoolean()
  allowDangerousGoods?: boolean;

  @IsOptional()
  @IsBoolean()
  allowReefer?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEmpty?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAllTypes?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => PolygonPointDto)
  polygon?: PolygonPointDto[];
}
