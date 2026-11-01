import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'admin@dmt.sn',
    description: 'Adresse e-mail du compte',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Admin@2026!',
    description: 'Mot de passe du compte (min. 1 caractère)',
    minLength: 1,
  })
  @IsString()
  @MinLength(1)
  password: string;
}
