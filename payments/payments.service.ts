import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, PaymentTermType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentTermDto } from './dto/payment-term.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  // Crée le Payment en amont — le style "unchecked create" utilisé pour
  // ShipmentFile/PreGate/YardContainer (scalar FKs directs) est incompatible
  // avec une création imbriquée `payment: { create: {...} }` dans Prisma ;
  // on crée donc le Payment séparément et on assigne juste son id ensuite.
  async createPayment(tenantId: string, dto: PaymentTermDto) {
    return this.prisma.payment.create({
      data: {
        tenantId,
        termType: dto.termType,
        method: dto.method,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async validatePayment(
    paymentId: string,
    tenantId: string,
    validatedById: string,
    notes?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status === PaymentStatus.VALIDATED) {
      throw new BadRequestException('Ce paiement est déjà validé.');
    }

    return this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.VALIDATED,
        validatedAt: new Date(),
        validatedById,
        notes: notes ?? payment.notes,
      },
    });
  }

  // Lève une erreur si la sortie doit être bloquée. À appeler avant tout Gate OUT
  // (WMS ExitMovement, YMS YardContainer) — ne bloque que AT_PICKUP non validé ;
  // ON_CREDIT et l'absence de modalité de paiement ne bloquent jamais.
  assertGateOutAllowed(
    payment: { termType: PaymentTermType; status: PaymentStatus } | null,
  ) {
    if (!payment) return;
    if (
      payment.termType === PaymentTermType.AT_PICKUP &&
      payment.status !== PaymentStatus.VALIDATED
    ) {
      throw new BadRequestException(
        'Paiement au enlèvement non validé — la sortie doit être autorisée par un directeur.',
      );
    }
  }
}
