import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsBoolean,
  Equals,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterTenantDto {
  @ApiProperty({
    example: 'Terminal Port de Lomé',
    description: "Nom de l'entreprise/organisation",
  })
  @IsString()
  @MinLength(2)
  companyName: string;

  @ApiPropertyOptional({
    example: 'terminal-lome',
    description: 'Identifiant URL-friendly — généré depuis companyName si omis',
  })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiProperty({ example: 'Jean' })
  @IsString()
  @MinLength(1)
  adminFirstName: string;

  @ApiProperty({ example: 'Dupont' })
  @IsString()
  @MinLength(1)
  adminLastName: string;

  @ApiProperty({ example: 'jean.dupont@terminal-lome.tg' })
  @IsEmail()
  adminEmail: string;

  @ApiPropertyOptional({ example: '+228 90 12 34 56' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    enum: ['WMS', 'YMS', 'TMS'],
    example: 'YMS',
    description:
      "Module unique disponible à l'inscription self-service (plan Starter)",
  })
  @IsIn(['WMS', 'YMS', 'TMS'])
  selectedModuleCode: 'WMS' | 'YMS' | 'TMS';

  @ApiProperty({
    example: true,
    description:
      "Doit être true — accord explicite aux conditions d'utilisation",
  })
  @IsBoolean()
  @Equals(true, {
    message: "Vous devez accepter les conditions d'utilisation.",
  })
  acceptedTerms: boolean;
}
