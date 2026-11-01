import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { MailModule } from './mail/mail.module';
import { WmsModule } from './wms/wms.module';
import { OperationsModule } from './operations/operations.module';
import { InducedServicesModule } from './induced-services/induced-services.module';
import { DosConfigModule } from './dos-config/dos-config.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CargoModule } from './cargo/cargo.module';
import { ReferentielsModule } from './referentiels/referentiels.module';
import { YmsModule } from './yms/yms.module';
import { AlertsModule } from './alerts/alerts.module';
import { YardMapModule } from './yard-map/yard-map.module';
import { PaymentsModule } from './payments/payments.module';
import { BillingModule } from './billing/billing.module';
import { RegistrationModule } from './registration/registration.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { TmsModule } from './tms/tms.module';
import { AccessControlModule } from './access-control/access-control.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    // Config globale (.env)
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting — par client (voir trust proxy dans main.ts). 600/min :
    // l'interface se rafraîchit seule (Gate In, parc…) et traite des lots
    // conteneur par conteneur ; 60/min bloquait l'usage normal. La connexion
    // garde sa propre limite stricte (auth.controller.ts).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),

    // Base de données
    PrismaModule,
    AuditModule,
    AccessControlModule,

    // Modules métier
    MailModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    WmsModule,
    OperationsModule,
    InducedServicesModule,
    DosConfigModule,
    InvoicesModule,
    CargoModule,
    ReferentielsModule,
    YmsModule,
    AlertsModule,
    YardMapModule,
    PaymentsModule,
    BillingModule,
    RegistrationModule,
    NotificationsModule,
    TmsModule,
    ReportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
