import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Obtener usuario
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json({ error: 'Error listando usuarios', details: listError }, { status: 500, headers: corsHeaders });
    }

    const superAdminUser = users.find(u => u.email === 'ggdisenioes@gmail.com');
    if (!superAdminUser) {
      return NextResponse.json({ error: 'Usuario no encontrado en auth' }, { status: 404, headers: corsHeaders });
    }

    // Obtener perfil
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', superAdminUser.id)
      .single();

    if (profileError) {
      return NextResponse.json({
        error: 'Error buscando perfil',
        userId: superAdminUser.id,
        profileError: profileError
      }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json({
      success: true,
      userId: superAdminUser.id,
      email: superAdminUser.email,
      profile: profile,
      profileColumns: Object.keys(profile || {})
    }, { headers: corsHeaders });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}
