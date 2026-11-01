import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsNumber,
  Min,
  IsObject,
  IsArray,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PolygonPointDto } from '../../yms/dto/create-yard-block-def.dto';

export class UpsertYardDto {
  @IsOptional() @IsString() code?: string;
  // Code actuel, envoyé à la modification pour renommer le dépôt sans en créer un autre.
  @IsOptional() @IsString() previousCode?: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['YARD', 'WAREHOUSE', 'BONDED_WAREHOUSE'])
  type: 'YARD' | 'WAREHOUSE' | 'BONDED_WAREHOUSE';
  @IsOptional() @IsNumber() @Min(0) surfaceM2?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsObject() stackingRules?: Record<string, unknown>;
  // Tracé du périmètre du yard, dessiné à main levée (pas d'image externe —
  // voir Yard.perimeter dans schema.prisma et YardBlockDef.polygon pour le
  // même format).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => PolygonPointDto)
  perimeter?: PolygonPointDto[];
}

export class PatchYardStackingRulesDto {
  @IsObject() stackingRules: Record<string, unknown>;
}
