"use client";

import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    // 1. Intentar login
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      setErrorMsg(
        error?.message === "Invalid login credentials"
          ? "Usuario o contraseña incorrectos"
          : error?.message ?? "Error al iniciar sesión"
      );
      setLoading(false);
      return;
    }

    // 2. Verificar si el usuario está activo en profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile || profile.active === false) {
      // 3. Si está deshabilitado, cerrar sesión inmediatamente
      await supabase.auth.signOut();
      setErrorMsg("Usuario deshabilitado, contacte su administrador.");
      setLoading(false);
      return;
    }

    // 4. Usuario activo → continuar
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 relative overflow-hidden">
      
      {/* Fondo decorativo sutil */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
         <div className="absolute right-0 top-0 w-64 h-64 bg-[#ccff00] rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
      </div>

      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md z-10 border-t-4 border-[#ccff00]">
        
        <div className="text-center mb-8">
            <h1 className="text-4xl font-extrabold text-gray-900 italic tracking-tight">
            TWINCO
            </h1>
            <span className="inline-block bg-gray-900 text-[#ccff00] px-2 py-0.5 text-xs font-bold tracking-[0.2em] uppercase rounded-sm mt-1">
                Pádel Manager
            </span>
            <p className="text-gray-400 text-sm mt-4">Bienvenido al club</p>
        </div>

        {errorMsg && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-3 mb-6 text-sm rounded-r">
                {errorMsg}
            </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Email</label>
                <input 
                    type="email" 
                    required
                    className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#ccff00] focus:border-transparent outline-none transition bg-gray-50"
                    placeholder="usuario@twinco.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Contraseña</label>
                <input 
                    type="password" 
                    required
                    className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#ccff00] focus:border-transparent outline-none transition bg-gray-50"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </div>

            <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-lg hover:bg-black transition duration-200 disabled:opacity-70 shadow-lg"
            >
                {loading ? 'Accediendo...' : 'Iniciar Sesión'}
            </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">
                Desarrollado por <a href="https://ggdisenio.es" target="_blank" className="text-gray-600 hover:text-[#aacc00] font-bold transition">GGDisenio.es</a>
            </p>
        </div>
      </div>
    </div>
  );
}