import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Blocage comptable d'un client — miroir de DosConfig.blockClient() côté
// frontend. Le motif est obligatoire (traçabilité — bénéfice §7 de la Note
// logique de service DMT Hub).
export class BlockClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
