import { z } from 'zod';

/**
 * Validación para crear un nuevo tenant
 */
export const CreateTenantSchema = z.object({
  name: z
    .string()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(255, 'El nombre no puede exceder 255 caracteres')
    .trim(),

  admin_email: z
    .string()
    .email('Email inválido')
    .toLowerCase(),

  phone: z
    .string()
    .regex(/^\+?[0-9\s\-\(\)]{7,}$/, 'Teléfono inválido')
    .optional()
    .or(z.literal('')),

  country: z
    .string()
    .length(2, 'Código de país debe ser 2 caracteres ISO')
    .toUpperCase()
    .optional()
    .or(z.literal('')),

  subscription_plan_id: z
    .string()
    .uuid('ID de plan inválido'),

  addon_ids: z
    .array(z.string().uuid('ID de add-on inválido'))
    .optional()
    .default([]),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

/**
 * Validación para actualizar un tenant
 */
export const UpdateTenantSchema = z.object({
  name: z.string().min(3).max(255).optional(),
  admin_email: z.string().email().optional(),
  phone: z.string().optional(),
  country: z.string().length(2).toUpperCase().optional(),
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(),
  subscription_plan_id: z.string().uuid().optional(),
  branding_config: z.record(z.any()).optional(),
});

export type UpdateTenantInput = z.infer<typeof UpdateTenantSchema>;

/**
 * Validación para cambiar plan de un tenant
 */
export const ChangeTenantPlanSchema = z.object({
  subscription_plan_id: z.string().uuid('ID de plan inválido'),
});

/**
 * Validación para cambiar estado de tenant
 */
export const ChangeTenantStatusSchema = z.object({
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
});

/**
 * Validación para agregar add-ons a un tenant
 */
export const AddTenantAddonsSchema = z.object({
  addon_ids: z.array(z.string().uuid()).min(1, 'Debe seleccionar al menos un add-on'),
});

/**
 * Validación para remover add-ons
 */
export const RemoveTenantAddonSchema = z.object({
  addon_id: z.string().uuid('ID de add-on inválido'),
});
