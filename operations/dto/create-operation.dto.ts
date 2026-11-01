import { IsEnum } from 'class-validator';
import { OperationType } from '@prisma/client';

export class CreateOperationDto {
  @IsEnum(OperationType)
  type: OperationType;
}
