import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Demande de changement d'emplacement sur une OperationLine déjà placée.
// `toSlot` a la même forme que operation_lines.slot (yard ou entrepôt).
// Miroir de requestSlotChange(id, lineId, slot, reason) côté frontend
// (dos-store.js).
export class SlotChangeRequestDto {
  @ApiProperty({
    description:
      'Nouvel emplacement demandé — {block,bay,row,tier} ou {warehouseId,zoneId,surfaceM2}',
  })
  @IsObject()
  toSlot: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DecideSlotChangeDto {
  @ApiProperty()
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
