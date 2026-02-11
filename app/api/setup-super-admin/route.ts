import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Obtener el usuario por email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json({ error: 'Error listando usuarios', details: listError }, { status: 500 });
    }

    const superAdminUser = users.find(u => u.email === 'ggdisenioes@gmail.com');

    if (!superAdminUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    // Actualizar el perfil
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: 'super_admin' })
      .eq('id', superAdminUser.id)
      .select();

    if (error) {
      return NextResponse.json({ error: 'Error actualizando perfil', details: error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '✅ Rol super_admin asignado correctamente',
      userId: superAdminUser.id,
      email: superAdminUser.email,
      updatedProfile: data,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
