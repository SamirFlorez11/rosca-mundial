// =============================================
// supabase.js — Conexión a Supabase
// Rosca Mundial 2026
// =============================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Estas variables las lee Vercel desde las Environment Variables
const SUPABASE_URL = 'https://hwhlmuixnxevzbabkqcy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Sub3P-1VhdcnNfhNzeet1A_yhQt_wJS';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Faltan las variables de entorno de Supabase');
}

// Cliente principal — usado en toda la app
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// =============================================
// Función para registrar logs
// =============================================
export async function registrarLog(accion, detalle = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('logs').insert({
      usuario_id: user?.id || null,
      accion,
      detalle,
      user_agent: navigator.userAgent
    });
  } catch (error) {
    console.error('Error registrando log:', error);
  }
}

// =============================================
// Función para obtener el usuario actual
// =============================================
export async function getUsuarioActual() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    const { data: perfil } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', user.id)
      .single();

    return perfil;
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    return null;
  }
}

// =============================================
// Función para verificar si el usuario está activo (pagó)
// =============================================
export async function verificarUsuarioActivo() {
  const perfil = await getUsuarioActual();
  if (!perfil) return false;
  return perfil.activo === true;
}
