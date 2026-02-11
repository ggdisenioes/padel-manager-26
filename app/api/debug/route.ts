import { NextResponse } from 'next/server';

export async function GET() {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  return NextResponse.json({
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
    serviceRoleKeyFirst50: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 50) || "NOT FOUND",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  }, { headers: corsHeaders });
}
