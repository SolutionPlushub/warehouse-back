import { IsEnum } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

// Moyen de règlement (espèces/virement/chèque) modifiable après création du
// dossier, depuis l'onglet Finance — voir WmsController.updatePaymentMethod().
export class UpdatePaymentMethodDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}
