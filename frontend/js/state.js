export const state = { me: null, ultimoTicket: null };
export const can = (p) => !!(state.me && state.me.permisos.includes(p));
export const canAny = (...ps) => ps.some(can);
export const isAdmin = () => !!(state.me && state.me.rol === 'administrador');
