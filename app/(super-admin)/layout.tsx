'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error } = await supabase.auth.getUser();

    if (!user || error) {
      router.push('/login');
      return;
    }

    // Verificar que sea super admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'super_admin') {
      router.push('/dashboard');
      return;
    }

    setUser(user);
    setIsChecking(false);
  };

  if (isChecking) {
    return <div className="p-8 text-center">Verificando acceso...</div>;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow">
        <div className="p-6 border-b">
          <h2 className="text-2xl font-bold text-gray-900">🚀 PadelX</h2>
          <p className="text-sm text-gray-600 mt-1">Super Admin</p>
        </div>

        <nav className="p-4 space-y-2">
          <NavLink href="/super-admin" label="📊 Dashboard" />
          <NavLink href="/super-admin/tenants" label="👥 Clientes" />
          <NavLink href="/super-admin/plans" label="📋 Planes" />
          <NavLink href="/super-admin/addons" label="➕ Add-ons" />
          <NavLink href="/super-admin/analytics" label="📈 Analytics" />
          <NavLink href="/super-admin/logs" label="📝 Auditoría" />
          <NavLink href="/super-admin/settings" label="⚙️ Configuración" />
        </nav>

        <div className="p-4 border-t mt-auto">
          <p className="text-xs text-gray-600 truncate">{user?.email}</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block px-4 py-2 rounded-lg hover:bg-blue-50 text-gray-700 hover:text-blue-600 transition"
    >
      {label}
    </a>
  );
}
