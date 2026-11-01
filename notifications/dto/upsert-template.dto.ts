import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  ArrayNotEmpty,
} from 'class-validator';
import { NotifChannel } from '@prisma/client';

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() trigger: string;
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(NotifChannel, { each: true })
  channels: NotifChannel[];
  @IsString() @IsNotEmpty() recipients: string;
  @IsString() @IsNotEmpty() body: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @IsNotEmpty() trigger?: string;
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(NotifChannel, { each: true })
  channels?: NotifChannel[];
  @IsOptional() @IsString() @IsNotEmpty() recipients?: string;
  @IsOptional() @IsString() @IsNotEmpty() body?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
