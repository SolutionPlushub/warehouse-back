import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateShipmentLineDto } from './create-shipment-line.dto';

export class BulkLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentLineDto)
  lines: CreateShipmentLineDto[];
}
