import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Check applicatif des limites de plan (users/modules/yards) — volontairement
// pas un Guard NestJS générique : les asserts ont besoin d'un accès Prisma
// (count + Subscription.plan) que le service concerné refait de toute façon.
// Appelé explicitement en première ligne des services métier (UsersService,
// TenantsService), jamais depuis les endpoints SUPER_ADMIN qui restent
// exemptés de ces limites (gestes commerciaux manuels).
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getActivePlan(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    // Pas d'abonnement (ex: tenant créé manuellement par SUPER_ADMIN avant
    // la mise en place de la facturation SaaS) → aucune limite appliquée.
    return subscription?.plan ?? null;
  }

  async assertCanAddUser(tenantId: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan || plan.maxUsers == null) return;

    const count = await this.prisma.user.count({ where: { tenantId } });
    if (count >= plan.maxUsers) {
      throw new ForbiddenException(
        `Limite de ${plan.maxUsers} utilisateurs atteinte pour le plan ${plan.name}. Passez à un plan supérieur pour en ajouter.`,
      );
    }
  }

  async assertCanActivateModule(
    tenantId: string,
    moduleCode: string,
  ): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan || plan.allModulesIncluded) return;

    if (
      plan.includedModules.length > 0 &&
      !plan.includedModules.includes(moduleCode)
    ) {
      throw new ForbiddenException(
        `Le module ${moduleCode} n'est pas inclus dans le plan ${plan.name}. Passez à un plan supérieur pour l'activer.`,
      );
    }

    if (plan.maxModules != null) {
      const activeCount = await this.prisma.tenantModule.count({
        where: { tenantId, isActive: true, moduleCode: { not: moduleCode } },
      });
      if (activeCount >= plan.maxModules) {
        throw new ForbiddenException(
          `Limite de ${plan.maxModules} module(s) actif(s) atteinte pour le plan ${plan.name}. Passez à un plan supérieur pour en activer davantage.`,
        );
      }
    }
  }

  async assertCanAddYard(tenantId: string): Promise<void> {
    const plan = await this.getActivePlan(tenantId);
    if (!plan || plan.maxYards == null) return;

    const count = await this.prisma.yard.count({ where: { tenantId } });
    if (count >= plan.maxYards) {
      throw new ForbiddenException(
        `Limite de ${plan.maxYards} yard(s) atteinte pour le plan ${plan.name}. Passez à un plan supérieur pour en ajouter.`,
      );
    }
  }

  async getUsageSummary(tenantId: string) {
    const plan = await this.getActivePlan(tenantId);
    const [users, yards, modules] = await Promise.all([
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.yard.count({ where: { tenantId } }),
      this.prisma.tenantModule.count({ where: { tenantId, isActive: true } }),
    ]);

    return {
      users: { used: users, max: plan?.maxUsers ?? null },
      yards: { used: yards, max: plan?.maxYards ?? null },
      modules: {
        used: modules,
        max: plan?.maxModules ?? null,
        included: plan?.includedModules ?? [],
      },
    };
  }
}
