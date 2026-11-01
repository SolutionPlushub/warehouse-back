import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'Admin@2026!',
    description: 'Mot de passe actuel',
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: 'NewSecure@2027!',
    description: 'Nouveau mot de passe (min. 8 caractères)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
