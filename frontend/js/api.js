export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path + qs(params), opts);
  } catch (e) {
    throw new ApiError('No hay conexión con el servidor. Revisa que el sistema esté encendido.', 0);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try { data = await res.json(); } catch { /* sin cuerpo */ }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new Event('sesion-expirada'));
    }
    let msg = data && data.detail;
    if (msg && typeof msg !== 'string') msg = JSON.stringify(msg);
    throw new ApiError(msg || `Error ${res.status}`, res.status);
  }
  return data;
}

export const get = (path, params) => api(path, { params });
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });

export const url = (path, params) => '/api' + path + qs(params);
