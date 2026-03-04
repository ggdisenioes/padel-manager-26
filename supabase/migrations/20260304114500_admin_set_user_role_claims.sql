DROP FUNCTION IF EXISTS public.admin_set_user_role(uuid, uuid, text);

CREATE FUNCTION public.admin_set_user_role(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_new_role text := lower(trim(coalesce(p_new_role, '')));
  v_admin_count integer;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR v_new_role NOT IN ('admin', 'manager', 'user') THEN
    RAISE EXCEPTION 'Parámetros inválidos.' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.profiles
   WHERE id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_actor.active IS DISTINCT FROM true
     OR coalesce(v_actor.role, '') <> 'admin'
     OR v_actor.tenant_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_target
    FROM public.profiles
   WHERE id = p_target_user_id
     AND tenant_id = v_actor.tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró usuario objetivo.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_target.role, '') = 'super_admin' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_target.role, '') = v_new_role THEN
    RETURN jsonb_build_object(
      'success', true,
      'unchanged', true,
      'user_id', v_target.id,
      'role', v_new_role
    );
  END IF;

  IF coalesce(v_target.role, '') = 'admin' AND v_new_role <> 'admin' THEN
    SELECT count(*)
      INTO v_admin_count
      FROM public.profiles
     WHERE tenant_id = v_actor.tenant_id
       AND role = 'admin'
       AND active = true
       AND deleted_at IS NULL;

    IF coalesce(v_admin_count, 0) <= 1 THEN
      RAISE EXCEPTION 'No se puede quitar el rol admin al único admin activo del tenant.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Ejecuta el update con identidad del actor para compatibilidad con triggers/policies existentes.
  PERFORM set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  UPDATE public.profiles
     SET role = v_new_role,
         active = true,
         deleted_at = CASE
           WHEN deleted_at IS NOT NULL AND active = false THEN NULL
           ELSE deleted_at
         END
   WHERE id = v_target.id;

  RETURN jsonb_build_object(
    'success', true,
    'unchanged', false,
    'user_id', v_target.id,
    'role', v_new_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, uuid, text) TO service_role;
