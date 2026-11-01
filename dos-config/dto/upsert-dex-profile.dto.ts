import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// Profil DEX (Direction Exploitation) — nom, titre, signature/cachet
// (URLs MinIO) et mention légale apposés sur les bons de sortie. Un seul
// profil actif par tenant. Miroir de DosConfig.setDex() côté frontend.
export class UpsertDexProfileDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsUrl() signatureUrl?: string;
  @IsOptional() @IsUrl() stampUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) mention?: string;
}
