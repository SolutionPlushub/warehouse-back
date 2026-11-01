import {
  Controller,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { ValidatePaymentDto } from './dto/validate-payment.dto';

interface AuthRequest extends Request {
  user: { id: string; tenantId: string; role: UserRole };
}

// Validation manuelle du paiement — réservée aux directeurs (ADMIN/SUPER_ADMIN),
// utilisée aussi bien depuis un dossier WMS que depuis un pré-gate YMS.
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Patch(':id/validate')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  validate(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: ValidatePaymentDto,
  ) {
    return this.paymentsService.validatePayment(
      id,
      req.user.tenantId,
      req.user.id,
      dto.notes,
    );
  }
}
