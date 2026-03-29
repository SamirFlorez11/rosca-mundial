// =============================================
// auth.js — Autenticación
// Rosca Mundial 2026
// =============================================

import { supabase, registrarLog, verificarUsuarioActivo } from './supabase.js';

// =============================================
// LOGIN
// =============================================
export async function login(correo, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: correo.trim().toLowerCase(),
      password: password
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        return { exito: false, mensaje: 'Correo o contraseña incorrectos' };
      }
      if (error.message.includes('Email not confirmed')) {
        return { exito: false, mensaje: 'Debes confirmar tu correo antes de ingresar' };
      }
      return { exito: false, mensaje: 'Error al iniciar sesión. Intenta de nuevo.' };
    }

    // Verificar que el usuario haya pagado
    const activo = await verificarUsuarioActivo();
    if (!activo) {
      await supabase.auth.signOut();
      return {
        exito: false,
        mensaje: 'Tu cuenta aún no está activa. Verifica que tu pago haya sido procesado.'
      };
    }

    await registrarLog('login', { correo });
    return { exito: true, usuario: data.user };

  } catch (error) {
    console.error('Error en login:', error);
    return { exito: false, mensaje: 'Error inesperado. Intenta de nuevo.' };
  }
}

// =============================================
// LOGOUT
// =============================================
export async function logout() {
  try {
    await registrarLog('logout');
    await supabase.auth.signOut();
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Error en logout:', error);
  }
}

// =============================================
// VERIFICAR SESIÓN ACTIVA
// Redirige al login si no hay sesión
// =============================================
export async function verificarSesion() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

// =============================================
// VERIFICAR SI YA ESTÁ LOGUEADO
// Redirige al dashboard si ya tiene sesión
// =============================================
export async function redirigirSiLogueado() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    window.location.href = '/dashboard.html';
  }
}

// =============================================
// OLVIDÉ MI CONTRASEÑA
// Envía email de restablecimiento
// =============================================
export async function olvideMiPassword(correo) {
  try {
    if (!correo.trim()) {
      return { exito: false, mensaje: 'Ingresa tu correo electrónico' };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(
      correo.trim().toLowerCase(),
      { redirectTo: 'https://roscamundial.com/restablecer-password.html' }
    );

    if (error) {
      return { exito: false, mensaje: 'Error enviando el correo. Verifica que el correo sea correcto.' };
    }

    await registrarLog('solicitud_reset_password', { correo });
    return {
      exito: true,
      mensaje: 'Te enviamos un enlace de restablecimiento. Revisa tu correo.'
    };

  } catch (error) {
    console.error('Error en reset password:', error);
    return { exito: false, mensaje: 'Error inesperado. Intenta de nuevo.' };
  }
}

// =============================================
// RESTABLECER CONTRASEÑA
// Se usa en la pantalla de nueva contraseña
// =============================================
export async function restablecerPassword(nuevaPassword) {
  try {
    const { error } = await supabase.auth.updateUser({
      password: nuevaPassword
    });

    if (error) {
      return { exito: false, mensaje: 'Error actualizando contraseña. El enlace puede haber expirado.' };
    }

    await registrarLog('password_restablecido');
    return { exito: true, mensaje: 'Contraseña actualizada exitosamente.' };

  } catch (error) {
    console.error('Error restableciendo password:', error);
    return { exito: false, mensaje: 'Error inesperado. Intenta de nuevo.' };
  }
}

// =============================================
// VERIFICAR SI EL USUARIO TIENE PICKS COMPLETOS
// =============================================
export async function verificarPicksCompletos(usuarioId) {
  try {
    // Verificar picks de equipos (5 categorias x 10 equipos = 50)
    const { count: picksEquipos } = await supabase
      .from('picks_equipos')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId);

    // Verificar picks killer (15 jugadores)
    const { count: picksKiller } = await supabase
      .from('picks_killer')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', usuarioId);

    const totalRequerido = 50 + 15; // 65 picks en total
    const totalActual = (picksEquipos || 0) + (picksKiller || 0);

    return {
      completos: totalActual >= totalRequerido,
      picksEquipos: picksEquipos || 0,
      picksKiller: picksKiller || 0,
      totalActual,
      totalRequerido,
      faltantes: totalRequerido - totalActual
    };
  } catch (error) {
    console.error('Error verificando picks:', error);
    return { completos: false, faltantes: 65 };
  }
}

// =============================================
// VERIFICAR SI LOS PICKS ESTÁN CERRADOS
// 30 minutos antes del primer partido
// =============================================
export function picksCerrados() {
  const inicioMundial = new Date('2026-06-11T23:00:00Z'); // 18:00 Colombia UTC-5
  const ahora = new Date();
  const treintaMinutesAntes = new Date(inicioMundial.getTime() - 30 * 60 * 1000);
  return ahora >= treintaMinutesAntes;
}
