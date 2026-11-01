import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideOperationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
