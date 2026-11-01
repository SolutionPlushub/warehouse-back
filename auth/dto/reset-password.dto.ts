import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'abc123def456...',
    description: 'Token reçu par e-mail (lien de réinitialisation)',
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'NewPassword@2026!',
    description: 'Nouveau mot de passe (min. 8 caractères)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
