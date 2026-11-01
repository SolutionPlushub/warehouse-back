import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'admin@dmt.sn',
    description: 'Adresse e-mail associée au compte',
  })
  @IsEmail()
  email: string;
}
