import { get } from '../api.js';
import { html, raw, setHTML, $, on, money, fdate, badge, tabla, iconBtn } from '../ui.js';
import { can } from '../state.js';
import { montarCobro } from '../cobro.js';
import { imprimirPorId, verTicket } from '../ticket.js';

const stat = (clase, titulo, valor, sub, href) => html`<a class="stat ${clase}" href="${href || '#'}" ${raw(href ? '' : 'tabindex="-1"')}>
  <div class="stat-t">${titulo}</div><div class="stat-v">${valor}</div>${sub ? html`<div class="stat-s">${sub}</div>` : ''}</a>`;

export async function dashboard(root, ctx) {
  const d = await get('/dashboard');
  if (d.mis_cursos) return vistaInstructor(root, d);

  const verPagos = can('pagos.ver');
  setHTML(root, html`<div class="dash">
    ${can('pagos.registrar') ? html`<section class="card cobro-card-wrap" id="cobro-slot"></section>` : ''}
    <section class="stats">
      ${stat('azul', 'ALUMNOS ACTIVOS', d.alumnos_activos, '', can('alumnos.ver') ? '#/alumnos?estado=activo' : '')}
      ${stat('azul', 'CURSOS ACTIVOS', d.cursos_activos, '', can('cursos.ver') ? '#/cursos?estado=activo' : '')}
      ${verPagos ? html`
        ${stat('verde', 'PAGOS DEL DÍA', money(d.pagos_dia), `${d.pagos_dia_cantidad} pago(s) hoy`, '#/pagos?tab=pagos&desde=hoy')}
        ${stat('verde', 'INGRESOS DEL MES', money(d.ingresos_mes), '', can('reportes.ver') ? '#/reportes' : '#/pagos?tab=pagos')}
        ${stat('rojo', 'PAGOS VENCIDOS', d.pagos_vencidos, `${d.alumnos_vencidos} alumno(s) · ${money(d.total_adeudos)}`, '#/pagos?estado=vencido')}
        ${stat('amarillo', 'PAGOS PRÓXIMOS', d.pagos_proximos, `vencen en ${d.dias_aviso} días o menos`, '#/pagos?estado=por_vencer')}` : ''}
    </section>
    <section class="grid3">
      <div class="card"><h3>Próximos cursos a iniciar</h3>${listaCursos(d.proximos_cursos, 'inicio')}</div>
      <div class="card"><h3>Cursos por terminar</h3>${listaCursos(d.cursos_por_terminar, 'fin')}</div>
      ${verPagos ? html`<div class="card"><h3>Alumnos con adeudos</h3>${listaAdeudos(d.alumnos_con_adeudo)}</div>` : ''}
    </section>
  </div>`);
  let widget;
  if (can('pagos.registrar')) {
    widget = montarCobro($('#cobro-slot', root), { inicial: ctx.params.get('m') || '' });
  }
  return () => { widget = null; };
}

function listaCursos(lista, cual) {
  if (!lista.length) return html`<div class="empty sm">Sin cursos</div>`;
  return html`<ul class="lista">${lista.map((c) => html`<li>
    <a href="#/curso/${c.id}"><b>${c.nombre}</b><small>${c.plantel || ''} · ${c.instructor || 'Sin instructor'}</small></a>
    <span class="fecha-chip">${cual === 'inicio' ? 'Inicia' : 'Termina'}<b>${fdate(cual === 'inicio' ? c.fecha_inicio : c.fecha_fin)}</b></span></li>`)}</ul>`;
}

function listaAdeudos(lista) {
  if (!lista.length) return html`<div class="empty sm">Nadie con adeudos 🎉</div>`;
  return html`<ul class="lista">${lista.map((a) => html`<li>
    <a href="#/alumno/${a.alumno_id}"><b>${a.nombre}</b><small><span class="mono">${a.matricula}</span> · ${a.dias_atraso} día(s) de atraso</small></a>
    <span class="monto rojo-t">${money(a.saldo)}</span></li>`)}</ul>
    <a class="ver-todo" href="#/pagos?estado=vencido">Ver todos los vencidos →</a>`;
}

function vistaInstructor(root, d) {
  setHTML(root, html`<div class="dash"><section class="card"><h3>Mis cursos</h3>
    ${d.mis_cursos.length ? html`<div class="cards-grid">${d.mis_cursos.map((c) => html`<div class="mini-card">
      <b>${c.nombre}</b><small>${c.plantel || ''} · ${c.horario || ''}</small>
      <div>${badge('curso', c.estado)}</div>
      <div class="row-btns"><a class="btn sm primary" href="#/asistencia?curso=${c.id}">Tomar asistencia</a>
      <a class="btn sm" href="#/curso/${c.id}">Ver alumnos</a></div></div>`)}</div>`
      : html`<div class="empty">No tienes cursos asignados.</div>`}
  </section></div>`);
}

// ---------------------------------------------------------------- pantalla de cobro (solo)
export async function cobroPagina(root, ctx) {
  setHTML(root, html`<div class="cobro-page">
    <section class="card" id="cobro-slot"></section>
    ${can('pagos.ver') ? html`<section class="card"><h3>Pagos de hoy</h3><div id="hoy"></div></section>` : ''}
  </div>`);
  const cargarHoy = async () => {
    if (!can('pagos.ver')) return;
    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const r = await get('/pagos', { desde: iso, hasta: iso, limit: 15 });
    const box = $('#hoy', root);
    if (!box) return;
    setHTML(box, html`${tabla([
      { label: 'Ticket', render: (p) => html`<b class="mono">${p.ticket}</b>` },
      { label: 'Matrícula', render: (p) => html`<span class="mono">${p.matricula}</span>` },
      { label: 'Alumno', key: 'alumno' },
      { label: 'Concepto', render: (p) => html`${p.concepto}<small class="block muted">${p.curso}</small>` },
      { label: 'Importe', cls: 'num', render: (p) => money(p.importe) },
      { label: 'Método', key: 'metodo' },
      { label: 'Estado', render: (p) => badge('pagoreg', p.estado) },
      { label: '', cls: 'acc', render: (p) => can('tickets.imprimir') && p.ticket_id ? html`${iconBtn('ver', p.ticket_id, 'Ver')}${iconBtn('imp', p.ticket_id, 'Imprimir')}` : '' },
    ], r.items, { vacio: 'Aún no hay pagos hoy' })}
    <p class="total-line">Total cobrado hoy: <b>${money(r.suma)}</b></p>`);
  };
  on(root, 'click', '[data-act="ver"]', (e, el) => verTicket(el.dataset.id));
  on(root, 'click', '[data-act="imp"]', (e, el) => imprimirPorId(el.dataset.id));
  montarCobro($('#cobro-slot', root), { inicial: ctx.params.get('m') || '', onCambio: (r) => { if (r === null || r) cargarHoy(); } });
  cargarHoy();
}
