import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateAccessRoleDto {
  @ApiProperty({ example: 'OPS_NUIT' })
  @IsString()
  code: string;

  @ApiProperty({ example: 'Opérations de nuit' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Réservé SUPER_ADMIN. Vide = profil système.' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}

export class UpdateAccessRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissionCodes: string[];
}

export class DuplicateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class SetUserAccessDto {
  @ApiProperty({ type: [String], description: 'Profils affectés. Tableau vide = retour au rôle historique.' })
  @IsArray()
  @IsString({ each: true })
  roleIds: string[];

  @ApiPropertyOptional({ type: [String], description: 'Permissions accordées en plus des profils.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grants?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Permissions retirées même si un profil les donne.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  denies?: string[];
}
