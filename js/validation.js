// =============================================
// validation.js — Validación de formularios
// Rosca Mundial 2026
// =============================================

// Valida formato de correo electrónico
export function validarCorreo(correo) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return regex.test(correo.trim());
}

// Valida contraseña: min 8 chars, 1 mayúscula, 1 minúscula, 1 especial
export function validarPassword(password) {
  if (password.length < 8) return { valido: false, mensaje: 'Mínimo 8 caracteres' };
  if (!/[A-Z]/.test(password)) return { valido: false, mensaje: 'Debe tener al menos 1 mayúscula' };
  if (!/[a-z]/.test(password)) return { valido: false, mensaje: 'Debe tener al menos 1 minúscula' };
  if (!/[^A-Za-z0-9]/.test(password)) return { valido: false, mensaje: 'Debe tener al menos 1 carácter especial (!@#$%...)' };
  return { valido: true, mensaje: '' };
}

// Valida nombre completo (mínimo nombre y apellido)
export function validarNombre(nombre) {
  const partes = nombre.trim().split(' ').filter(Boolean);
  return partes.length >= 2;
}

// Valida número de celular (mínimo 7 dígitos)
export function validarCelular(celular) {
  const soloNumeros = celular.replace(/\D/g, '');
  return soloNumeros.length >= 7;
}

// Valida número de documento (mínimo 5 caracteres)
export function validarDocumento(documento) {
  return documento.trim().length >= 5;
}

// Muestra error en un campo del formulario
export function mostrarError(inputEl, mensaje) {
  inputEl.classList.add('error');
  const errorEl = inputEl.parentElement.querySelector('.error-msg');
  if (errorEl) {
    errorEl.textContent = mensaje;
    errorEl.style.display = 'block';
  }
}

// Limpia error de un campo del formulario
export function limpiarError(inputEl) {
  inputEl.classList.remove('error');
  const errorEl = inputEl.parentElement.querySelector('.error-msg');
  if (errorEl) {
    errorEl.style.display = 'none';
  }
}

// Limpia todos los errores de un formulario
export function limpiarTodosLosErrores(formEl) {
  formEl.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
  formEl.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none');
}
