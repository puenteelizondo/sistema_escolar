// Utilidades de interfaz: plantillas con escape automático, modales, avisos, formato.

// ---------------------------------------------------------------- plantillas seguras
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderVal(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderVal).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

/** Etiqueta de plantilla: escapa todo lo interpolado salvo `raw()` y otros `html`. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += renderVal(v) + strings[i + 1]; });
  return new Raw(out);
}

export const setHTML = (el, r) => { el.innerHTML = String(r); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegación de eventos: on(root, 'click', '[data-act]', (ev, el) => ...) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) fn(ev, el);
  });
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// ---------------------------------------------------------------- formato
const MXN0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MXN2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? MXN0.format(v) : MXN2.format(v);
}

export function fdate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function fdatetime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', hour12: false });
}
const MESES_ABR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
export function fdateTicket(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d} ${MESES_ABR[+m - 1]} ${y}`;
}
export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

// ---------------------------------------------------------------- insignias de estado
const BADGES = {
  pago: {
    al_corriente: ['verde', 'AL CORRIENTE'], por_vencer: ['amarillo', 'PRÓXIMO A VENCER'],
    vencido: ['rojo', 'VENCIDO'], sin_curso: ['gris', 'SIN CURSO ACTIVO'],
  },
  mens: {
    pagado: ['verde', 'Pagado'], pendiente: ['azul', 'Pendiente'], parcial: ['amarillo', 'Parcial'],
    vencido: ['rojo', 'Vencido'], cancelada: ['gris', 'Cancelado'], por_vencer: ['amarillo', 'Por vencer'],
  },
  alumno: {
    activo: ['verde', 'Activo'], inactivo: ['gris', 'Inactivo'], terminado: ['azul', 'Terminado'],
    suspendido: ['amarillo', 'Suspendido'], baja: ['rojo', 'Baja'],
  },
  curso: {
    proximo: ['azul', 'Próximo'], inscripciones_abiertas: ['azul', 'Inscripciones abiertas'],
    activo: ['verde', 'Activo'], terminado: ['gris', 'Terminado'], cancelado: ['rojo', 'Cancelado'],
  },
  insc: { activa: ['verde', 'Activa'], terminada: ['gris', 'Terminada'], retirada: ['rojo', 'Retirada'] },
  pagoreg: { aplicado: ['verde', 'Aplicado'], cancelado: ['rojo', 'Cancelado'] },
  asis: {
    asistencia: ['verde', 'Asistencia'], falta: ['rojo', 'Falta'], retardo: ['amarillo', 'Retardo'],
    justificada: ['azul', 'Justificada'],
  },
};
export function badge(tipo, valor, { dot = false } = {}) {
  const b = (BADGES[tipo] || {})[valor] || ['gris', valor ?? '—'];
  return html`<span class="badge b-${b[0]}">${dot ? raw('<i class="dot"></i>') : ''}${b[1]}</span>`;
}
export const estadoMens = (m) => (m.estado === 'pendiente' && m.por_vencer ? 'por_vencer' : m.estado);

// ---------------------------------------------------------------- avisos
export function toast(msg, tipo = 'ok', ms = 3500) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast t-${tipo}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------------------------------------------------------- modales
const pila = [];
export function modal({ titulo, cuerpo, ancho = 'md', cerrable = true, onClose, clase = '' }) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal m-${ancho} ${clase}" role="dialog" aria-modal="true">
    ${titulo ? `<div class="modal-head"><h3>${esc(titulo)}</h3>${cerrable ? '<button class="icon-btn" data-close aria-label="Cerrar">✕</button>' : ''}</div>` : ''}
    <div class="modal-body"></div></div>`;
  const body = back.querySelector('.modal-body');
  if (cuerpo !== undefined) body.innerHTML = String(cuerpo);
  root.appendChild(back);
  document.body.classList.add('modal-open');
  const previo = document.activeElement;
  const api = {
    el: back.querySelector('.modal'), body, cerrable,
    close(valor) {
      const i = pila.indexOf(api);
      if (i >= 0) pila.splice(i, 1);
      back.remove();
      if (!pila.length) document.body.classList.remove('modal-open');
      if (previo && previo.focus && document.contains(previo)) previo.focus();
      onClose && onClose(valor);
    },
    setTitulo(t) { const h = back.querySelector('.modal-head h3'); if (h) h.textContent = t; },
  };
  back.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });
  pila.push(api);
  const foco = body.querySelector('[autofocus]') || body.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button.primary');
  setTimeout(() => foco && foco.focus(), 30);
  return api;
}

export const modalAbierto = () => pila.length > 0;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pila.length) {
    const top = pila[pila.length - 1];
    if (top.cerrable) { e.preventDefault(); top.close(); }
  }
});

export function confirmar({ titulo = 'Confirmar', mensaje, si = 'Aceptar', no = 'Cancelar', peligro = false }) {
  return new Promise((resolve) => {
    let resuelto = false;
    const fin = (v) => { if (!resuelto) { resuelto = true; resolve(v); } };
    const m = modal({
      titulo, ancho: 'sm', onClose: () => fin(false),
      cuerpo: html`<p class="confirm-msg">${mensaje}</p>
        <div class="modal-actions"><button class="btn" data-no>${no}</button>
        <button class="btn ${peligro ? 'danger' : 'primary'}" data-si autofocus>${si}</button></div>`,
    });
    on(m.body, 'click', '[data-no]', () => m.close());
    on(m.body, 'click', '[data-si]', () => { fin(true); m.close(); });
  });
}

/** Pide un texto obligatorio (p. ej. motivo de cancelación). Devuelve el texto o null. */
export function pedirTexto({ titulo, mensaje, etiqueta = 'Motivo', si = 'Aceptar', peligro = false, requerido = true }) {
  return new Promise((resolve) => {
    let resuelto = false;
    const fin = (v) => { if (!resuelto) { resuelto = true; resolve(v); } };
    const m = modal({
      titulo, ancho: 'sm', onClose: () => fin(null),
      cuerpo: html`<form class="form"><p>${mensaje}</p>
        <label class="field"><span>${etiqueta}</span><textarea name="t" rows="3" maxlength="255" ${requerido ? 'required' : ''} autofocus></textarea></label>
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn ${peligro ? 'danger' : 'primary'}">${si}</button></div></form>`,
    });
    m.body.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = e.target.t.value.trim();
      if (requerido && t.length < 3) {
        const er = m.body.querySelector('.form-error');
        er.hidden = false;
        er.textContent = 'Escribe al menos 3 caracteres.';
        return;
      }
      fin(t); m.close();
    });
  });
}

// ---------------------------------------------------------------- formularios
export function campo(label, name, valor = '', { tipo = 'text', requerido = false, attrs = '', ayuda = '', clase = '' } = {}) {
  return html`<label class="field ${clase}"><span>${label}${requerido ? raw('<b class="req">*</b>') : ''}</span>
    <input type="${tipo}" name="${name}" value="${valor ?? ''}" ${raw(requerido ? 'required' : '')} ${raw(attrs)}>
    ${ayuda ? html`<small>${ayuda}</small>` : ''}</label>`;
}

export function selector(label, name, opciones, valor = '', { requerido = false, vacio = null, attrs = '', clase = '' } = {}) {
  const ops = opciones.map((o) => {
    if (Array.isArray(o)) return o;
    if (o === null || typeof o !== 'object') return [o, o];
    return [o.value ?? o.id, o.label ?? o.nombre];
  });
  return html`<label class="field ${clase}"><span>${label}${requerido ? raw('<b class="req">*</b>') : ''}</span>
    <select name="${name}" ${raw(requerido ? 'required' : '')} ${raw(attrs)}>
      ${vacio !== null ? html`<option value="">${vacio}</option>` : ''}
      ${ops.map(([v, l]) => html`<option value="${v}" ${raw(String(v) === String(valor ?? '') ? 'selected' : '')}>${l}</option>`)}
    </select></label>`;
}

export function areaTexto(label, name, valor = '', { filas = 3, clase = '', requerido = false } = {}) {
  return html`<label class="field ${clase}"><span>${label}${requerido ? raw('<b class="req">*</b>') : ''}</span>
    <textarea name="${name}" rows="${filas}" ${raw(requerido ? 'required' : '')}>${valor ?? ''}</textarea></label>`;
}

/** Lee un <form> y devuelve un objeto; textos vacíos -> null; number/checkbox convertidos. */
export function leerForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { out[el.name] = el.checked; continue; }
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; continue; }
    let v = el.value;
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    else if (el.type === 'number' || el.dataset.num !== undefined) v = Number(v);
    out[el.name] = v;
  }
  return out;
}

export function mostrarError(form, msg) {
  let er = form.querySelector('.form-error');
  if (!er) {
    er = document.createElement('div');
    er.className = 'form-error';
    const acts = form.querySelector('.modal-actions');
    if (acts) acts.before(er); else form.appendChild(er);
  }
  er.hidden = !msg;
  er.textContent = msg || '';
}

/** Envía un formulario modal con bloqueo de botón y manejo de errores. */
export function enviarForm(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button:not([type=button]):not([data-close])');
    mostrarError(form, '');
    if (btn) btn.disabled = true;
    try {
      await fn(leerForm(form));
    } catch (err) {
      mostrarError(form, err.message);
      if (btn) btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- tablas
export function tabla(columnas, filas, { vacio = 'Sin resultados', clase = '' } = {}) {
  if (!filas.length) return html`<div class="empty">${vacio}</div>`;
  return html`<div class="table-wrap"><table class="tabla ${clase}">
    <thead><tr>${columnas.map((c) => html`<th class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${filas.map((f) => html`<tr ${raw(f._attrs || '')} class="${f._cls || ''}">${columnas.map((c) => html`<td class="${c.cls || ''}" data-label="${c.label}">${c.render ? c.render(f) : f[c.key]}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

export function iconBtn(act, id, texto, { clase = '', titulo = '' } = {}) {
  return html`<button class="btn sm ${clase}" data-act="${act}" data-id="${id}" title="${titulo || texto}">${texto}</button>`;
}

export function descargar(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function toggleCargando(el, on_ = true) {
  el.classList.toggle('cargando', on_);
}

export function spinner() {
  return html`<div class="loading"><div class="spin"></div></div>`;
}

/** Reduce una imagen a un data URL JPEG/PNG pequeño (foto de alumno, logo). */
export function imagenADataURL(file, maxLado = 320, tipo = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('No se pudo leer la imagen'));
    rd.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
      img.onload = () => {
        const esc_ = Math.min(1, maxLado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * esc_);
        c.height = Math.round(img.height * esc_);
        const ctx = c.getContext('2d');
        if (tipo === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(tipo, 0.85));
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}


/** Ventana para tomar la foto con la cámara (o subir un archivo). Devuelve un data URL o null si se cancela. */
export function capturarFoto(maxLado = 320) {
  return new Promise((resolve) => {
    let stream = null, listo = false;
    const fin = (v) => { if (stream) stream.getTracks().forEach((t) => t.stop()); if (!listo) { listo = true; m.close(v); } };
    const m = modal({
      titulo: 'Fotografía del alumno', ancho: 'md', onClose: (v) => { if (stream) stream.getTracks().forEach((t) => t.stop()); resolve(v || null); },
      cuerpo: `<div class="cam">
        <div class="cam-box"><video autoplay playsinline muted></video><div class="cam-msg" hidden></div></div>
        <div class="modal-actions">
          <label class="btn">Subir archivo<input type="file" accept="image/*" hidden data-arch></label>
          <button type="button" class="btn primary" data-tomar disabled>📷 TOMAR FOTO</button>
        </div></div>`,
    });
    const video = m.body.querySelector('video'), msg = m.body.querySelector('.cam-msg'), btn = m.body.querySelector('[data-tomar]');
    const aviso = (t) => { msg.textContent = t; msg.hidden = false; };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      aviso('La cámara solo funciona con https o desde localhost. Usa "Subir archivo".');
    } else {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
        .then((st) => { stream = st; video.srcObject = st; btn.disabled = false; if (listo) st.getTracks().forEach((t) => t.stop()); })
        .catch(() => aviso('No se pudo usar la cámara (permiso denegado o no hay cámara). Usa "Subir archivo".'));
    }
    btn.addEventListener('click', () => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w) return;
      const lado = Math.min(w, h);                      // recorte cuadrado centrado
      const out = Math.min(maxLado, lado);
      const c = document.createElement('canvas');
      c.width = c.height = out;
      c.getContext('2d').drawImage(video, (w - lado) / 2, (h - lado) / 2, lado, lado, 0, 0, out, out);
      fin(c.toDataURL('image/jpeg', 0.85));
    });
    m.body.querySelector('[data-arch]').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { fin(await imagenADataURL(f, maxLado)); } catch (err) { aviso(err.message); }
    });
  });
}
