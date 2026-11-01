import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmAccountDto {
  @ApiProperty({
    example: 'abc123def456...',
    description: "Token reçu par e-mail (lien d'invitation)",
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'MyPassword@2026!',
    description:
      'Mot de passe choisi pour activer le compte (min. 8 caractères)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
