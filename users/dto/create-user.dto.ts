import { IsString, IsEmail, IsOptional, IsIn, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'Karim', description: 'Prénom' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Benali', description: 'Nom de famille' })
  @IsString()
  lastName: string;

  @ApiProperty({
    example: 'k.benali@dmt.sn',
    description: 'Adresse e-mail (unique)',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: ['SUPER_ADMIN', 'ADMIN', 'AGENT', 'CLIENT', 'CUSTOMS', 'DEX'],
    example: 'AGENT',
    description: "Rôle attribué à l'utilisateur",
  })
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'AGENT', 'CLIENT', 'CUSTOMS', 'DEX'])
  role: string;

  @ApiPropertyOptional({
    example: 'clxyz456',
    description: 'ID du tenant (obligatoire sauf pour SUPER_ADMIN)',
  })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({
    example: ['WMS', 'YMS'],
    description: 'Modules accessibles pour cet utilisateur (sous-ensemble des modules du tenant)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];
}
