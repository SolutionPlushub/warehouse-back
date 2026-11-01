import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RegistrationService } from './registration.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';

@ApiTags('Registration')
@Controller('register')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Inscription self-service — créer un compte opérateur',
    description:
      'Crée un tenant OPERATOR en plan Starter avec un essai gratuit de 14 jours (sans carte bancaire). Envoie un e-mail de confirmation de compte (token valable 48h). Route publique, non protégée par JWT.',
  })
  @ApiBody({ type: RegisterTenantDto })
  @ApiResponse({
    status: 201,
    description: 'Compte créé, e-mail de confirmation envoyé',
    schema: {
      example: {
        tenantId: 'clxyz456',
        message:
          'Compte créé. Vérifiez votre boîte mail pour activer votre compte.',
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Cet e-mail est déjà utilisé' })
  register(@Body() dto: RegisterTenantDto) {
    return this.registration.register(dto);
  }
}
