import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

// Déclenche un envoi (journalisé) à partir d'un template — voir
// NotificationsService.send() pour la note sur le périmètre réel
// (pas de fournisseur SMS/Email branché).
export class SendNotificationDto {
  @IsString() @IsNotEmpty() to: string;
  @IsOptional() @IsString() subject?: string;
}
