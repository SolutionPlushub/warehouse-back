import { IsOptional, IsString } from 'class-validator';

export class ValidatePaymentDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
