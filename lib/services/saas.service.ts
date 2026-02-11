import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  Tenant,
  TenantWithPlan,
  CreateTenantPayload,
  PaginatedResponse,
  SaaSMetrics,
} from '@/lib/types/saas';

/**
 * Servicio de gestión de Tenants (Clientes SaaS)
 */
export class TenantService {
  private supabase: any;

  constructor() {
    const cookieStore = cookies();
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
  }

  /**
   * Crear un nuevo tenant
   */
  async createTenant(payload: CreateTenantPayload): Promise<TenantWithPlan> {
    // Generar slug
    const slug = this.generateSlug(payload.name);

    // Verificar duplicados
    const { data: existing } = await this.supabase
      .from('tenants')
      .select('id')
      .or(`name.eq.${payload.name},admin_email.eq.${payload.admin_email}`)
      .single();

    if (existing) {
      throw new Error('Tenant con ese nombre o email ya existe');
    }

    // Insertar tenant
    const { data: tenant, error } = await this.supabase
      .from('tenants')
      .insert({
        name: payload.name,
        slug,
        admin_email: payload.admin_email,
        phone: payload.phone || null,
        country: payload.country || null,
        subscription_plan_id: payload.subscription_plan_id,
        status: 'trial',
        trial_started_at: new Date().toISOString(),
        trial_ends_at: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Asignar add-ons si hay
    if (payload.addon_ids && payload.addon_ids.length > 0) {
      const addonInserts = payload.addon_ids.map((addon_id) => ({
        tenant_id: tenant.id,
        addon_id,
      }));

      const { error: addonError } = await this.supabase
        .from('tenant_addons')
        .insert(addonInserts);

      if (addonError) throw addonError;
    }

    // Registrar en auditoría
    await this.logAction('TENANT_CREATED', tenant.id, null, tenant);

    // Retornar tenant con relaciones
    return this.getTenantFull(tenant.id);
  }

  /**
   * Obtener tenant con todas sus relaciones
   */
  async getTenantFull(tenantId: string): Promise<TenantWithPlan> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select(
        `
        *,
        subscription_plan:subscription_plans(*),
        addons:tenant_addons(*, addon:addons(*)),
        usage:tenant_usage(*)
      `
      )
      .eq('id', tenantId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Listar tenants con paginación
   */
  async listTenants(
    page = 1,
    limit = 20,
    filters?: any
  ): Promise<PaginatedResponse<Tenant>> {
    let query = this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .is('deleted_at', null);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.search) {
      query = query.or(
        `name.ilike.%${filters.search}%,admin_email.ilike.%${filters.search}%`
      );
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;

    return {
      data,
      pagination: {
        page,
        limit,
        count: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  /**
   * Actualizar plan de un tenant
   */
  async updateTenantPlan(
    tenantId: string,
    newPlanId: string
  ): Promise<TenantWithPlan> {
    const { data: oldTenant } = await this.supabase
      .from('tenants')
      .select('subscription_plan_id')
      .eq('id', tenantId)
      .single();

    const { data, error } = await this.supabase
      .from('tenants')
      .update({
        subscription_plan_id: newPlanId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) throw error;

    await this.logAction(
      'PLAN_CHANGED',
      tenantId,
      { old_plan_id: oldTenant.subscription_plan_id },
      { new_plan_id: newPlanId }
    );

    return this.getTenantFull(tenantId);
  }

  /**
   * Actualizar estado de un tenant
   */
  async updateTenantStatus(
    tenantId: string,
    newStatus: string
  ): Promise<TenantWithPlan> {
    const { data: oldTenant } = await this.supabase
      .from('tenants')
      .select('status')
      .eq('id', tenantId)
      .single();

    const { data, error } = await this.supabase
      .from('tenants')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
        subscription_started_at:
          newStatus === 'active' ? new Date().toISOString() : undefined,
      })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) throw error;

    await this.logAction(
      'STATUS_CHANGED',
      tenantId,
      { old_status: oldTenant.status },
      { new_status: newStatus }
    );

    return this.getTenantFull(tenantId);
  }

  /**
   * Agregar add-ons a un tenant
   */
  async addAddonsToTenant(
    tenantId: string,
    addonIds: string[]
  ): Promise<void> {
    const addonInserts = addonIds.map((addon_id) => ({
      tenant_id: tenantId,
      addon_id,
    }));

    const { error } = await this.supabase
      .from('tenant_addons')
      .insert(addonInserts)
      .on('*', 'INSERT', async (payload) => {
        await this.logAction(
          'ADDON_ADDED',
          tenantId,
          null,
          { addon_id: payload.new.addon_id }
        );
      });

    if (error) throw error;
  }

  /**
   * Remover add-on de un tenant
   */
  async removeAddonFromTenant(
    tenantId: string,
    addonId: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tenant_addons')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('addon_id', addonId);

    if (error) throw error;

    await this.logAction(
      'ADDON_REMOVED',
      tenantId,
      { addon_id: addonId },
      null
    );
  }

  /**
   * Verificar si tenant excede límites
   */
  async checkTenantLimits(tenantId: string): Promise<{
    isOverLimit: boolean;
    limits: Record<string, any>;
  }> {
    const tenant = await this.getTenantFull(tenantId);
    const usage = tenant.usage?.[0];
    const plan = tenant.subscription_plan;

    if (!usage || !plan) return { isOverLimit: false, limits: {} };

    const checks = {
      players: {
        current: usage.player_count,
        limit: plan.max_players,
        isOver: usage.player_count > plan.max_players,
      },
      tournaments: {
        current: usage.active_tournament_count,
        limit: plan.max_concurrent_tournaments,
        isOver: usage.active_tournament_count > plan.max_concurrent_tournaments,
      },
    };

    const isOverLimit = Object.values(checks).some((check) => check.isOver);

    return { isOverLimit, limits: checks };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '');
  }

  private async logAction(
    action: string,
    tenantId: string,
    oldValues: any,
    newValues: any
  ): Promise<void> {
    await this.supabase
      .from('super_admin_action_logs')
      .insert({
        action,
        tenant_id: tenantId,
        old_values: oldValues,
        new_values: newValues,
      })
      .catch((err) => console.error('Log error:', err));
  }
}

/**
 * Servicio de Suscripciones y Facturación
 */
export class SubscriptionService {
  private supabase: any;

  constructor() {
    const cookieStore = cookies();
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
  }

  /**
   * Calcular próxima factura
   */
  async calculateNextInvoice(
    tenantId: string
  ): Promise<{ base_plan_price: number; addons_price: number; total_price: number }> {
    const { data: tenant } = await this.supabase
      .from('tenants')
      .select(
        `
        subscription_plan:subscription_plans(price_eur),
        addons:tenant_addons(addon:addons(price_eur, billing_type))
      `
      )
      .eq('id', tenantId)
      .single();

    if (!tenant) throw new Error('Tenant no encontrado');

    const basePlanPrice = tenant.subscription_plan?.price_eur || 0;
    const addonsPrice = (tenant.addons || [])
      .filter((ta: any) => ta.addon?.billing_type === 'monthly')
      .reduce((sum: number, ta: any) => sum + (ta.addon?.price_eur || 0), 0);

    return {
      base_plan_price: basePlanPrice,
      addons_price: addonsPrice,
      total_price: basePlanPrice + addonsPrice,
    };
  }
}

/**
 * Servicio de Analytics
 */
export class AnalyticsService {
  private supabase: any;

  constructor() {
    const cookieStore = cookies();
    this.supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
  }

  /**
   * Calcular MRR
   */
  async calculateMRR(): Promise<number> {
    const { data: activeTenants } = await this.supabase
      .from('tenants')
      .select(
        `
        subscription_plan:subscription_plans(price_eur),
        addons:tenant_addons(addon:addons(price_eur, billing_type))
      `
      )
      .eq('status', 'active');

    let mrr = 0;
    (activeTenants || []).forEach((tenant: any) => {
      const basePlan = tenant.subscription_plan?.price_eur || 0;
      const addonsPrice = (tenant.addons || [])
        .filter((ta: any) => ta.addon?.billing_type === 'monthly')
        .reduce((sum: number, ta: any) => sum + (ta.addon?.price_eur || 0), 0);
      mrr += basePlan + addonsPrice;
    });

    return mrr;
  }

  /**
   * Obtener todas las métricas
   */
  async getMetrics(): Promise<SaaSMetrics> {
    const mrr = await this.calculateMRR();
    const activeTenants = await this.getActiveTenantCount();
    const trialTenants = await this.getTrialTenantCount();
    const churnRate = await this.calculateChurnRate();
    const planDistribution = await this.getPlanDistribution();
    const addonsPopularity = await this.getAddonsPopularity();

    return {
      mrr,
      arr: mrr * 12,
      activeTenants,
      trialTenants,
      churnRate,
      planDistribution,
      addonsPopularity,
    };
  }

  private async getActiveTenantCount(): Promise<number> {
    const { count } = await this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .eq('status', 'active');
    return count || 0;
  }

  private async getTrialTenantCount(): Promise<number> {
    const { count } = await this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .eq('status', 'trial');
    return count || 0;
  }

  private async calculateChurnRate(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: churned } = await this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .eq('status', 'cancelled')
      .gte('deleted_at', thirtyDaysAgo.toISOString());

    const { count: total } = await this.supabase
      .from('tenants')
      .select('*', { count: 'exact' })
      .eq('status', 'active');

    return total ? ((churned || 0) / total) * 100 : 0;
  }

  private async getPlanDistribution(): Promise<Record<string, number>> {
    const { data } = await this.supabase
      .from('tenants')
      .select('subscription_plan:subscription_plans(name)')
      .eq('status', 'active');

    const dist: Record<string, number> = {};
    (data || []).forEach((tenant: any) => {
      const planName = tenant.subscription_plan?.name || 'Unknown';
      dist[planName] = (dist[planName] || 0) + 1;
    });

    return dist;
  }

  private async getAddonsPopularity(): Promise<Record<string, number>> {
    const { data } = await this.supabase
      .from('tenant_addons')
      .select('addon:addons(name)');

    const popularity: Record<string, number> = {};
    (data || []).forEach((ta: any) => {
      const addonName = ta.addon?.name || 'Unknown';
      popularity[addonName] = (popularity[addonName] || 0) + 1;
    });

    return popularity;
  }
}
