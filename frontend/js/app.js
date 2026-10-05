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
const CARRO_SVG = `<svg class="lg-car" viewBox="0 0 700 220" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="cb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d3ea"/></linearGradient>
    <radialGradient id="fa" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7fd0ff" stop-opacity=".9"/><stop offset="1" stop-color="#7fd0ff" stop-opacity="0"/></radialGradient>
  </defs>
  <g stroke="#4aa3ff" stroke-width="3" stroke-linecap="round" opacity=".55"><path d="M10 120h120M30 140h90M0 160h110"/></g>
  <ellipse cx="350" cy="196" rx="300" ry="12" fill="#000" opacity=".45"/>
  <path d="M96 168c-22 0-34-8-36-24l-2-18c0-12 8-20 20-22l86-20 74-42c10-6 22-9 34-9h126c18 0 34 6 48 17l56 40 74 12c18 3 28 14 28 32v10c0 7-5 12-12 12h-30a50 50 0 0 0-100 0H224a50 50 0 0 0-100 0z" fill="url(#cb)"/>
  <path d="M232 100l64-40h120c12 0 22 4 31 11l44 31z" fill="#0b1636" stroke="#4aa3ff" stroke-width="2"/>
  <path d="M356 60v40" stroke="#c9d3ea" stroke-width="3"/>
  <path d="M60 138h582" stroke="#e11d2e" stroke-width="7"/>
  <path d="M60 150h582" stroke="#12203a" stroke-width="3" opacity=".5"/>
  <path d="M618 122h22c8 0 12 5 12 12v4h-34z" fill="#fff6c9"/>
  <ellipse cx="648" cy="130" rx="46" ry="26" fill="url(#fa)"/>
  <g><circle cx="174" cy="170" r="42" fill="#0b1636" stroke="#e5ecfa" stroke-width="4"/><circle cx="174" cy="170" r="22" fill="#12203a" stroke="#8fb7ff" stroke-width="3"/><path d="M174 148v44M152 170h44M158 154l32 32M190 154l-32 32" stroke="#8fb7ff" stroke-width="2.5"/>
  <circle cx="500" cy="170" r="42" fill="#0b1636" stroke="#e5ecfa" stroke-width="4"/><circle cx="500" cy="170" r="22" fill="#12203a" stroke="#8fb7ff" stroke-width="3"/><path d="M500 148v44M478 170h44M484 154l32 32M516 154l-32 32" stroke="#8fb7ff" stroke-width="2.5"/></g>
</svg>`;
const BANDERA = `<svg class="lg-flag" viewBox="0 0 64 32" aria-hidden="true"><rect width="64" height="32" fill="#fff"/>${
  Array.from({ length: 16 }, (_, i) => { const x = (i % 8) * 8, y = Math.floor(i / 8) * 8 + ((i % 8) % 2 ? 0 : 8); return `<rect x="${x}" y="${y}" width="8" height="8" fill="#0b1636"/>`; }).join('')
}</svg>`;
const CARRERAS = [
  'Técnico profesional en motores a gasolina', 'Técnico profesional en electricidad automotriz',
  'Diplomado en electrónica automotriz', 'Reparación de computadoras automotrices',
];

async function mostrarLogin(mensaje) {
  try { publica = await get('/config/publica'); } catch { /* usa valores por defecto */ }
  state.me = null;
  document.title = publica.escuela_nombre;
  const { CIRCUITO } = await import('./loginart.js');
  setHTML(app, html`<div class="login-wrap">
    ${raw(CIRCUITO)}
    <div class="lg-glow"></div>
    <section class="lg-hero">
      <div class="lg-brand">
        ${publica.logo ? html`<img class="lg-logo" src="${publica.logo}" alt="">` : html`<div class="lg-logo-ph">${raw(icon('tool', 34))}</div>`}
        <div class="lg-nombre">${publica.escuela_nombre}</div>
      </div>
      <h2 class="lg-titulo">Invertir en tu <span>capacitación</span><br>es garantizar un mejor futuro</h2>
      <div class="lg-carreras">
        <div class="lg-car-t">CARRERAS</div>
        <ul>${CARRERAS.map((c) => html`<li>${raw(icon('check', 16))}<span>${c}</span></li>`)}</ul>
      </div>
      <div class="lg-cinta"><b>Estudia una carrera</b> con gran demanda laboral</div>
      ${raw(CARRO_SVG)}
    </section>
    <main class="login-side">
      <form class="login-card" autocomplete="on">
        ${raw(BANDERA)}
        <div class="login-mini">
          ${publica.logo ? html`<img class="login-logo" src="${publica.logo}" alt="">` : html`<div class="login-logo-ph">${raw(icon('tool', 34))}</div>`}
          <div class="login-mini-n">${publica.escuela_nombre}</div>
        </div>
        <div>
          <h1>Bienvenido</h1>
          <p class="muted">Inicia sesión para entrar al sistema</p>
        </div>
        <label class="field ico-field"><span>Usuario</span>
          <div class="in-ico">${raw(icon('user', 18))}<input name="username" autocomplete="username" placeholder="Tu usuario" autofocus required></div></label>
        <label class="field ico-field"><span>Contraseña</span>
          <div class="in-ico">${raw(icon('key', 18))}<input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required>
            <button type="button" class="ojo" data-ojo aria-label="Mostrar contraseña">Ver</button></div></label>
        <div class="form-error" ${raw(mensaje ? '' : 'hidden')}>${mensaje || ''}</div>
        <button class="btn primary xl block login-go">INICIAR SESIÓN</button>
        <p class="login-pie">¿Olvidaste tu acceso? Pídelo al administrador de la escuela.</p>
      </form>
    </main></div>`);
  $('[data-ojo]', app).addEventListener('click', (e) => {
    const inp = $('input[name=password]', app);
    const ver = inp.type === 'password';
    inp.type = ver ? 'text' : 'password';
    e.currentTarget.textContent = ver ? 'Ocultar' : 'Ver';
  });
  const f = $('form', app);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('.login-go', f);
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
