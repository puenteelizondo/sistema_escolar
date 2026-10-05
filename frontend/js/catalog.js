// Catálogos que se usan en muchos formularios (se piden una sola vez por pantalla).
import { get } from './api.js';

let cache = {};
export const invalidar = () => { cache = {}; };

export async function planteles() {
  return (cache.pl ??= await get('/planteles'));
}
export async function instructores() {
  return (cache.in ??= await get('/instructores'));
}
export async function cursosActivos() {
  return get('/cursos');
}
export const AREAS = ['Mecánica', 'Electricidad', 'Electrónica', 'Diagnóstico automotriz', 'Otro'];
export const ESTADOS_CURSO = [
  ['proximo', 'Próximo'], ['inscripciones_abiertas', 'Inscripciones abiertas'], ['activo', 'Activo'],
  ['terminado', 'Terminado'], ['cancelado', 'Cancelado'],
];
export const ESTADOS_ALUMNO = [
  ['activo', 'Activo'], ['inactivo', 'Inactivo'], ['terminado', 'Terminado'], ['suspendido', 'Suspendido'], ['baja', 'Baja'],
];
export const DIAS = [['L', 'Lun'], ['M', 'Mar'], ['X', 'Mié'], ['J', 'Jue'], ['V', 'Vie'], ['S', 'Sáb'], ['D', 'Dom']];
export const diasTexto = (s) => (s ? s.split(',').map((d) => (DIAS.find((x) => x[0] === d) || [0, d])[1]).join(', ') : '—');
