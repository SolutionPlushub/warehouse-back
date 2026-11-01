import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EirCondition, EirType } from '@prisma/client';

// Inspection d'une unité (ShipmentLine ou YardContainer) au Gate — checklist
// + condition + description + photos. Persistée comme EIR (referenceType
// résolu par le contrôleur appelant selon l'endpoint utilisé). Miroir de
// inspectUnit(id, lineId, insp) côté frontend (dos-store.js).
export class InspectUnitDto {
  // ENTRY par défaut (arrivée/Gate In) ; EXIT pour une inspection en cours
  // d'exécution (placement, EIR de sortie...) — voir OP_STEP_SPECS.eir/
  // placement côté frontend (op-procedures.jsx).
  @ApiPropertyOptional({ enum: EirType })
  @IsOptional()
  @IsEnum(EirType)
  type?: EirType;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  checks?: string[];

  @ApiPropertyOptional({ enum: EirCondition })
  @IsOptional()
  @IsEnum(EirCondition)
  condition?: EirCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}
