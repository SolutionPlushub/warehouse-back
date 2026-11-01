import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AiReportChatDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  @MaxLength(8000)
  message!: string;
}
