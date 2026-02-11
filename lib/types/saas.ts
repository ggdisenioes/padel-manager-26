// ============================================================
// TIPOS SaaS - SUPER ADMIN DASHBOARD
// ============================================================

/**
 * Planes de suscripción
 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  description?: string;
  price_eur: number;
  max_players: number;
  max_concurrent_tournaments: number;
  max_courts: number;
  has_advanced_rankings: boolean;
  has_player_stats: boolean;
  has_leagues: boolean;
  has_online_registration: boolean;
  has_api_access: boolean;
  has_mobile_app: boolean;
  has_live_scoring: boolean;
  has_white_label: boolean;
  has_integrations: boolean;
  support_level: 'email' | 'priority' | 'premium';
  support_response_hours: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Add-ons disponibles
 */
export interface Addon {
  id: string;
  name: string;
  description?: string;
  price_eur: number;
  billing_type: 'monthly' | 'one_time';
  slug: string;
  icon?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Clientes (Tenants)
 */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  admin_email: string;
  phone?: string;
  country?: string;
  subscription_plan_id: string;
  status: 'trial' | 'active' | 'suspended' | 'cancelled';
  trial_started_at: string;
  trial_ends_at: string;
  subscription_started_at?: string;
  subscription_ends_at?: string;
  branding_config: Record<string, any>;
  features_usage: Record<string, any>;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

/**
 * Cliente con detalles expandidos
 */
export interface TenantWithPlan extends Tenant {
  subscription_plan?: SubscriptionPlan;
  addons?: TenantAddon[];
  usage?: TenantUsage[];
  invoices?: SubscriptionInvoice[];
}

/**
 * Add-ons activos para un tenant
 */
export interface TenantAddon {
  id: string;
  tenant_id: string;
  addon_id: string;
  activated_at: string;
  deactivated_at?: string;
  purchase_date: string;
  addon?: Addon;
}

/**
 * Uso actual de un tenant
 */
export interface TenantUsage {
  id: string;
  tenant_id: string;
  player_count: number;
  active_tournament_count: number;
  booking_count_monthly: number;
  api_calls_monthly: number;
  measured_at: string;
}

/**
 * Factura de suscripción
 */
export interface SubscriptionInvoice {
  id: string;
  tenant_id: string;
  billing_period_start: string;
  billing_period_end: string;
  base_plan_price: number;
  addons_price: number;
  total_price: number;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  created_at: string;
  paid_at?: string;
  due_at?: string;
}

/**
 * Entrada de auditoría
 */
export interface SuperAdminActionLog {
  id: string;
  super_admin_user_id?: string;
  tenant_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

/**
 * Payload para crear tenant
 */
export interface CreateTenantPayload {
  name: string;
  admin_email: string;
  phone?: string;
  country?: string;
  subscription_plan_id: string;
  addon_ids?: string[];
}

/**
 * Respuesta de API con paginación
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    count: number;
    totalPages: number;
  };
}

/**
 * Métricas SaaS
 */
export interface SaaSMetrics {
  mrr: number;
  arr: number;
  activeTenants: number;
  trialTenants: number;
  churnRate: number;
  planDistribution: Record<string, number>;
  addonsPopularity: Record<string, number>;
}
