import { get, post, put } from './api.js';
import { html, raw, setHTML, $, on, toast, modal, enviarForm, campo, esc } from './ui.js';
import { state, can, canAny } from './state.js';
import { icon } from './icons.js';
import { dashboard, cobroPagina } from './pages/dashboard.js';
import { alumnos, expediente } from './pages/alumnos.js';
import { cursos, cursoDetalle } from './pages/cursos.js';
import { pagos } from './pages/pagos.js';
import { tickets } from './pages/tickets.js';
import { asistencia } from './pages/asistencia.js';
import { calendario } from './pages/calendario.js';
import { reportes } from './pages/reportes.js';
import { instructores, planteles } from './pages/catalogos.js';
import { usuarios } from './pages/usuarios.js';
import { configuracion } from './pages/config.js';
import { entrada } from './pages/entrada.js';

const app = document.getElementById('app');

// ruta -> {titulo, icono, perm (cualquiera), pagina, menu}
const RUTAS = {
  inicio: { titulo: 'Inicio', icono: 'home', pagina: dashboard, menu: true },
  cobro: { titulo: 'Cobro rápido', icono: 'cash', perm: ['pagos.registrar'], pagina: cobroPagina, menu: true },
  alumnos: { titulo: 'Alumnos', icono: 'users', perm: ['alumnos.ver'], pagina: alumnos, menu: true },
  alumno: { titulo: 'Expediente', icono: 'users', perm: ['alumnos.ver'], pagina: expediente, activa: 'alumnos' },
  cursos: { titulo: 'Cursos', icono: 'book', perm: ['cursos.ver'], pagina: cursos, menu: true },
  curso: { titulo: 'Curso', icono: 'book', perm: ['cursos.ver'], pagina: cursoDetalle, activa: 'cursos' },
  pagos: { titulo: 'Pagos', icono: 'card', perm: ['pagos.ver'], pagina: pagos, menu: true },
  tickets: { titulo: 'Tickets', icono: 'receipt', perm: ['tickets.ver'], pagina: tickets, menu: true },
  asistencia: { titulo: 'Asistencia', icono: 'check', perm: ['asistencia.ver', 'asistencia.registrar'], pagina: asistencia, menu: true },
  entrada: { titulo: 'Entrada (lector)', icono: 'check', perm: ['asistencia.escanear'], pagina: entrada, menu: true },
  calendario: { titulo: 'Calendario', icono: 'calendar', perm: ['calendario.ver'], pagina: calendario, menu: true },
  reportes: { titulo: 'Reportes', icono: 'chart', perm: ['reportes.ver'], pagina: reportes, menu: true },
  instructores: { titulo: 'Instructores', icono: 'tool', perm: ['catalogos.admin'], pagina: instructores, menu: 'admin' },
  planteles: { titulo: 'Planteles', icono: 'building', perm: ['catalogos.admin'], pagina: planteles, menu: 'admin' },
  usuarios: { titulo: 'Usuarios', icono: 'key', perm: ['usuarios.admin'], pagina: usuarios, menu: 'admin' },
  config: { titulo: 'Configuración', icono: 'gear', perm: ['config.admin', 'respaldos.admin', 'bitacora.ver'], pagina: configuracion, menu: 'admin' },
};

let limpiar = null;
let publica = { escuela_nombre: 'Sistema Escolar', logo: '' };

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q = ''] = h.split('?');
  const args = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { clave: args[0] || (state.me && state.me.rol === 'instructor' ? 'asistencia' : state.me && state.me.rol === 'entrada' ? 'entrada' : 'inicio'), args: args.slice(1), params: new URLSearchParams(q) };
}

// ---------------------------------------------------------------- login
async function mostrarLogin(mensaje) {
  try { publica = await get('/config/publica'); } catch { /* usa valores por defecto */ }
  state.me = null;
  document.title = publica.escuela_nombre;
  setHTML(app, html`<div class="login-wrap">
    <form class="login-card" autocomplete="on">
      ${publica.logo ? html`<img class="login-logo" src="${publica.logo}" alt="">` : html`<div class="login-logo-ph">${raw(icon('tool', 34))}</div>`}
      <h1>${publica.escuela_nombre}</h1>
      <p class="muted">Control escolar y caja</p>
      <label class="field"><span>Usuario</span><input name="username" autocomplete="username" autofocus required></label>
      <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error" ${raw(mensaje ? '' : 'hidden')}>${mensaje || ''}</div>
      <button class="btn primary xl block">INICIAR SESIÓN</button>
    </form></div>`);
  const f = $('form', app);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', f);
    const er = $('.form-error', f);
    btn.disabled = true;
    er.hidden = true;
    try {
      state.me = await post('/auth/login', { username: f.username.value.trim(), password: f.password.value });
      iniciar();
    } catch (err) {
      er.hidden = false;
      er.textContent = err.message;
      btn.disabled = false;
      f.password.select();
    }
  });
}

window.addEventListener('sesion-expirada', () => {
  if (state.me) mostrarLogin('Tu sesión expiró. Vuelve a iniciar sesión.');
});

// ---------------------------------------------------------------- estructura
function permitido(r) {
  return !r.perm || canAny(...r.perm);
}

function menuHTML() {
  const item = (k, r) => html`<a href="#/${k}" class="nav-item" data-ruta="${k}">${raw(icon(r.icono, 20))}<span>${r.titulo}</span></a>`;
  const principales = Object.entries(RUTAS).filter(([, r]) => r.menu === true && permitido(r));
  const admin = Object.entries(RUTAS).filter(([, r]) => r.menu === 'admin' && permitido(r));
  return html`${principales.map(([k, r]) => item(k, r))}
    ${admin.length ? html`<div class="nav-sec">Administración</div>${admin.map(([k, r]) => item(k, r))}` : ''}`;
}

function iniciar() {
  document.title = publica.escuela_nombre || 'Sistema Escolar';
  const me = state.me;
  setHTML(app, html`<div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        ${publica.logo ? html`<img src="${publica.logo}" alt="">` : html`<div class="brand-ph">${raw(icon('tool', 22))}</div>`}
        <div class="brand-name">${publica.escuela_nombre}</div>
      </div>
      <nav>${menuHTML()}</nav>
      <div class="side-foot">
        <div class="who"><div class="who-av">${(me.nombre || '?')[0].toUpperCase()}</div>
          <div><div class="who-n">${me.nombre}</div><div class="who-r">${me.rol_etiqueta}</div></div></div>
        <button class="nav-item" data-pass>${raw(icon('key', 18))}<span>Cambiar contraseña</span></button>
        <button class="nav-item" data-salir>${raw(icon('logout', 18))}<span>Cerrar sesión</span></button>
      </div>
    </aside>
    <div class="scrim" data-scrim></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn hamb" data-menu aria-label="Menú">${raw(icon('menu', 22))}</button>
        <h1 id="page-title"></h1>
        ${canAny('alumnos.ver', 'pagos.registrar') ? html`<form class="gsearch" data-gsearch>${raw(icon('search', 18))}
          <input name="q" placeholder="Buscar matrícula o nombre…" autocomplete="off" aria-label="Buscar alumno"></form>` : ''}
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
  </div>`);

  on(app, 'click', '[data-menu]', () => document.body.classList.toggle('menu-abierto'));
  on(app, 'click', '[data-scrim]', () => document.body.classList.remove('menu-abierto'));
  on(app, 'click', '.nav-item[href]', () => document.body.classList.remove('menu-abierto'));
  on(app, 'click', '[data-salir]', async () => {
    try { await post('/auth/logout'); } catch { /* ignorar */ }
    location.hash = '';
    mostrarLogin();
  });
  on(app, 'click', '[data-pass]', cambiarPassword);
  const g = $('[data-gsearch]', app);
  if (g) g.addEventListener('submit', busquedaGlobal);
  enrutar();
}

async function busquedaGlobal(e) {
  e.preventDefault();
  const input = e.target.q;
  const q = input.value.trim();
  if (!q) return;
  try {
    const lista = await get('/alumnos/buscar', { q });
    const exacto = lista.find((a) => a.matricula === q.toUpperCase());
    input.value = '';
    input.blur();
    if (exacto) {
      location.hash = can('pagos.registrar') ? `#/cobro?m=${exacto.matricula}` : `#/alumno/${exacto.id}`;
    } else if (lista.length === 1 && !can('alumnos.ver')) {
      location.hash = `#/cobro?m=${lista[0].matricula}`;
    } else {
      location.hash = `#/alumnos?q=${encodeURIComponent(q)}`;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function cambiarPassword() {
  const m = modal({
    titulo: 'Cambiar contraseña', ancho: 'sm',
    cuerpo: html`<form class="form">
      ${campo('Contraseña actual', 'actual', '', { tipo: 'password', requerido: true, attrs: 'autocomplete="current-password" autofocus' })}
      ${campo('Contraseña nueva (mínimo 6)', 'nueva', '', { tipo: 'password', requerido: true, attrs: 'minlength="6" autocomplete="new-password"' })}
      ${campo('Repite la contraseña nueva', 'repite', '', { tipo: 'password', requerido: true, attrs: 'minlength="6" autocomplete="new-password"' })}
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
  });
  enviarForm($('form', m.body), async (d) => {
    if (d.nueva !== d.repite) throw new Error('Las contraseñas nuevas no coinciden');
    await post('/auth/password', { actual: d.actual, nueva: d.nueva });
    m.close();
    toast('Contraseña actualizada');
  });
}

// ---------------------------------------------------------------- enrutador
async function enrutar() {
  if (!state.me) return;
  const { clave, args, params } = parseHash();
  const ruta = RUTAS[clave];
  let view = $('#view');
  if (!view) return;
  if (typeof limpiar === 'function') { try { limpiar(); } catch { /* ignorar */ } }
  limpiar = null;
  // Elemento nuevo en cada navegación: así no se acumulan oyentes de eventos de páginas anteriores.
  const fresco = view.cloneNode(false);
  view.replaceWith(fresco);
  view = fresco;
  document.body.classList.remove('menu-abierto');
  if (!ruta) {
    setHTML(view, html`<div class="empty big">Página no encontrada. <a href="#/inicio">Ir al inicio</a></div>`);
    $('#page-title').textContent = 'No encontrada';
    return;
  }
  const activa = ruta.activa || clave;
  document.querySelectorAll('.nav-item[data-ruta]').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === activa));
  $('#page-title').textContent = ruta.titulo;
  document.title = `${ruta.titulo} · ${publica.escuela_nombre}`;
  if (!permitido(ruta)) {
    setHTML(view, html`<div class="empty big">No tienes permiso para ver esta sección.</div>`);
    return;
  }
  setHTML(view, html`<div class="loading"><div class="spin"></div></div>`);
  try {
    const ctx = {
      args, params, publica, titulo: (t) => { $('#page-title').textContent = t; },
      refrescar: () => enrutar(),
    };
    const out = await ruta.pagina(view, ctx);
    if (typeof out === 'function') limpiar = out;
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    setHTML(view, html`<div class="alert rojo">${e.message || 'Ocurrió un error al cargar la página'}</div>`);
  }
}

window.addEventListener('hashchange', enrutar);

// ---------------------------------------------------------------- arranque
(async function main() {
  try { publica = await get('/config/publica'); } catch { /* se mostrará el login */ }
  try {
    state.me = await get('/auth/me');
    iniciar();
  } catch (e) {
    if (e.status === 401 || e.status === 0) mostrarLogin(e.status === 0 ? e.message : undefined);
    else mostrarLogin(e.message);
  }
})();
