import { get, post } from '../api.js';
import {
  html, raw, setHTML, $, on, debounce, money, fdate, badge, estadoMens, tabla, iconBtn, toast, selector, campo,
  pedirTexto, hoyISO,
} from '../ui.js';
import { can } from '../state.js';
import { planteles } from '../catalog.js';
import { verTicket, imprimirPorId } from '../ticket.js';

const CHIPS = [
  ['adeudo', 'Adeudos'], ['vencido', 'Vencidos'], ['por_vencer', 'Próximos a vencer'], ['pendiente', 'Pendientes'],
  ['parcial', 'Abonos'], ['pagado', 'Pagados'], ['', 'Todos'],
];

export async function pagos(root, ctx) {
  const [pl, cursos, metodos] = await Promise.all([
    planteles(), get('/cursos').catch(() => []), get('/metodos-pago').catch(() => ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro']),
  ]);
  const p = ctx.params;
  const fecha = (v) => (v === 'hoy' ? hoyISO() : v || '');
  let tab = p.get('tab') === 'pagos' ? 'pagos' : 'cargos';
  const fc = { estado: p.has('estado') ? p.get('estado') : 'adeudo', q: '', curso_id: '', plantel_id: '', desde: p.get('tab') === 'pagos' ? '' : fecha(p.get('desde')), hasta: p.get('tab') === 'pagos' ? '' : fecha(p.get('hasta')) };
  const fp = { q: '', desde: p.get('tab') === 'pagos' ? fecha(p.get('desde')) : '', hasta: p.get('tab') === 'pagos' ? fecha(p.get('hasta')) : '', metodo: '', estado: '', curso_id: '', plantel_id: '' };
  const cursosOps = cursos.map((c) => [c.id, `${c.nombre} (${c.codigo})`]);
  const plOps = pl.map((x) => [x.id, x.nombre]);

  setHTML(root, html`<div class="card">
    <div class="tabs"><button class="tab" data-tab="cargos">Mensualidades y adeudos</button><button class="tab" data-tab="pagos">Pagos registrados</button></div>
    <div id="cuerpo"></div></div>`);
  const cuerpo = $('#cuerpo', root);

  const pintarTabs = () => root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));

  async function vistaCargos() {
    setHTML(cuerpo, html`
      <div class="chips-row">${CHIPS.map(([k, l]) => html`<button class="chip-btn ${fc.estado === k ? 'activo' : ''}" data-estado="${k}">${l}</button>`)}</div>
      <div class="toolbar">
        <input class="grow" type="search" name="q" placeholder="Matrícula o nombre…" value="${fc.q}">
        ${selector('', 'curso_id', cursosOps, fc.curso_id, { vacio: 'Todos los cursos', clase: 'inline' })}
        ${selector('', 'plantel_id', plOps, fc.plantel_id, { vacio: 'Todos los planteles', clase: 'inline' })}
        <label class="inline-f">Vence desde <input type="date" name="desde" value="${fc.desde}"></label>
        <label class="inline-f">hasta <input type="date" name="hasta" value="${fc.hasta}"></label>
      </div><div id="tabla"></div>`);
    await cargarCargos();
  }
  async function cargarCargos() {
    const r = await get('/mensualidades', fc);
    setHTML($('#tabla', cuerpo), html`${tabla([
      { label: 'Matrícula', render: (m) => html`<a class="mono strong" href="#/alumno/${m.alumno_id}">${m.matricula}</a>` },
      { label: 'Alumno', key: 'alumno' },
      { label: 'Curso', key: 'curso' },
      { label: 'Concepto', key: 'etiqueta' },
      { label: 'Fecha límite', render: (m) => fdate(m.fecha_limite) },
      { label: 'Importe', cls: 'num', render: (m) => money(m.importe) },
      { label: 'Pagado', cls: 'num', render: (m) => money(m.pagado) },
      { label: 'Saldo', cls: 'num strong', render: (m) => money(m.saldo) },
      { label: 'Estado', render: (m) => html`${badge('mens', estadoMens(m))}${m.dias_atraso ? html`<small class="block muted">${m.dias_atraso} día(s) de atraso</small>` : ''}` },
      { label: '', cls: 'acc', render: (m) => can('pagos.registrar') && m.saldo > 0 ? html`<a class="btn sm primary" href="#/cobro?m=${m.matricula}">Cobrar</a>` : '' },
    ], r.items, { vacio: 'No hay registros con este filtro. 🎉' })}
    <div class="pager"><span>${r.items.length} de ${r.total} registro(s)</span><span class="total-line">Saldo: <b>${money(r.saldo)}</b></span></div>`);
  }

  async function vistaPagos() {
    setHTML(cuerpo, html`
      <div class="toolbar">
        <input class="grow" type="search" name="q" placeholder="Ticket, matrícula o nombre…" value="${fp.q}">
        <label class="inline-f">Desde <input type="date" name="desde" value="${fp.desde}"></label>
        <label class="inline-f">hasta <input type="date" name="hasta" value="${fp.hasta}"></label>
        ${selector('', 'metodo', metodos, fp.metodo, { vacio: 'Todos los métodos', clase: 'inline' })}
        ${selector('', 'estado', [['aplicado', 'Aplicados'], ['cancelado', 'Cancelados']], fp.estado, { vacio: 'Todos los estados', clase: 'inline' })}
        ${selector('', 'curso_id', cursosOps, fp.curso_id, { vacio: 'Todos los cursos', clase: 'inline' })}
      </div><div id="tabla"></div>`);
    await cargarPagos();
  }
  async function cargarPagos() {
    const r = await get('/pagos', fp);
    setHTML($('#tabla', cuerpo), html`${tabla([
      { label: 'Ticket', render: (x) => html`<b class="mono">${x.ticket || '—'}</b>` },
      { label: 'Fecha', render: (x) => fdate(x.fecha) },
      { label: 'Matrícula', render: (x) => html`<a class="mono strong" href="#/alumno/${x.alumno_id}">${x.matricula}</a>` },
      { label: 'Alumno', key: 'alumno' },
      { label: 'Concepto', render: (x) => html`${x.concepto}<small class="block muted">${x.curso}</small>` },
      { label: 'Importe', cls: 'num strong', render: (x) => money(x.importe) },
      { label: 'Método', key: 'metodo' },
      { label: 'Usuario', render: (x) => x.usuario || '—' },
      { label: 'Estado', render: (x) => html`${badge('pagoreg', x.estado)}${x.motivo_cancelacion ? html`<small class="block muted">${x.motivo_cancelacion}</small>` : ''}` },
      { label: '', cls: 'acc', render: (x) => html`${x.ticket_id && can('tickets.ver') ? iconBtn('ver', x.ticket_id, 'Ver') : ''}
        ${x.ticket_id && can('tickets.imprimir') ? iconBtn('imp', x.ticket_id, 'Imprimir') : ''}
        ${can('pagos.cancelar') && x.estado === 'aplicado' ? html`<button class="btn sm danger-o" data-act="cancelar" data-id="${x.id}" data-t="${x.ticket}">Cancelar</button>` : ''}` },
    ], r.items.map((x) => ({ ...x, _cls: x.estado === 'cancelado' ? 'tachado' : '' })), { vacio: 'No hay pagos con esos filtros.' })}
    <div class="pager"><span>${r.items.length} de ${r.total} pago(s)</span><span class="total-line">Total cobrado (sin cancelados): <b>${money(r.suma)}</b></span></div>`);
  }

  const cambiarTab = async (t) => { tab = t; pintarTabs(); await (t === 'pagos' ? vistaPagos() : vistaCargos()); };
  on(root, 'click', '[data-tab]', (e, el) => cambiarTab(el.dataset.tab).catch((er) => toast(er.message, 'error')));
  on(root, 'click', '[data-estado]', (e, el) => { fc.estado = el.dataset.estado; vistaCargos().catch((er) => toast(er.message, 'error')); });
  const recargar = debounce(() => (tab === 'pagos' ? cargarPagos() : cargarCargos()).catch((e) => toast(e.message, 'error')), 250);
  cuerpo.addEventListener('input', (e) => {
    const f = tab === 'pagos' ? fp : fc;
    if (e.target.name in f) { f[e.target.name] = e.target.value; recargar(); }
  });
  on(root, 'click', '[data-act="ver"]', (e, el) => verTicket(el.dataset.id, { puedeImprimir: can('tickets.imprimir') }));
  on(root, 'click', '[data-act="imp"]', (e, el) => imprimirPorId(el.dataset.id));
  on(root, 'click', '[data-act="cancelar"]', async (e, el) => {
    const motivo = await pedirTexto({
      titulo: 'Cancelar pago', mensaje: `Se cancelará el pago del ticket ${el.dataset.t}. El ticket se conserva en el historial marcado como cancelado y el saldo vuelve a quedar pendiente.`,
      etiqueta: 'Motivo de la cancelación', si: 'Cancelar pago', peligro: true,
    });
    if (motivo === null) return;
    try { await post(`/pagos/${el.dataset.id}/cancelar`, { motivo }); toast('Pago cancelado'); cargarPagos(); } catch (er) { toast(er.message, 'error'); }
  });
  pintarTabs();
  await (tab === 'pagos' ? vistaPagos() : vistaCargos());
}
