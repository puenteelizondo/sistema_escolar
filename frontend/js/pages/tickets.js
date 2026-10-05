import { get } from '../api.js';
import { html, setHTML, $, on, debounce, money, fdate, badge, tabla, iconBtn, toast } from '../ui.js';
import { can } from '../state.js';
import { verTicket, imprimirPorId, pdfURL } from '../ticket.js';

export async function tickets(root, ctx) {
  const f = { q: ctx.params.get('q') || '', desde: '', hasta: '' };
  let limite = 100;
  setHTML(root, html`<div class="card">
    <div class="toolbar">
      <input class="grow" type="search" name="q" placeholder="Buscar por número de ticket, matrícula o nombre…" value="${f.q}" autofocus>
      <label class="inline-f">Desde <input type="date" name="desde"></label>
      <label class="inline-f">hasta <input type="date" name="hasta"></label>
    </div><div id="lista"></div></div>`);
  async function cargar() {
    const r = await get('/tickets', { ...f, limit: limite });
    setHTML($('#lista', root), html`${tabla([
      { label: 'No.', render: (t) => html`<b class="mono">${t.numero_texto}</b>` },
      { label: 'Fecha', render: (t) => fdate(t.fecha) },
      { label: 'Alumno', key: 'alumno' },
      { label: 'Matrícula', render: (t) => html`<span class="mono">${t.matricula}</span>` },
      { label: 'Curso', key: 'curso' },
      { label: 'Concepto', key: 'concepto' },
      { label: 'Importe', cls: 'num strong', render: (t) => money(t.importe) },
      { label: 'Método', key: 'metodo' },
      { label: 'Usuario', render: (t) => t.usuario || '—' },
      { label: 'Estado', render: (t) => badge('pagoreg', t.estado) },
      { label: '', cls: 'acc', render: (t) => html`${iconBtn('ver', t.id, 'Ver')}${can('tickets.imprimir') ? iconBtn('imp', t.id, 'Imprimir') : ''}
        <a class="btn sm" href="${pdfURL(t.id)}" target="_blank" rel="noopener">PDF</a>` },
    ], r.items.map((t) => ({ ...t, _cls: t.estado === 'cancelado' ? 'tachado' : '' })), { vacio: 'No se encontraron tickets.' })}
    <div class="pager"><span>${r.items.length} de ${r.total} ticket(s)</span>${r.total > r.items.length ? html`<button class="btn" data-mas>Mostrar más</button>` : ''}</div>`);
  }
  const recargar = debounce(() => { limite = 100; cargar().catch((e) => toast(e.message, 'error')); }, 250);
  root.addEventListener('input', (e) => { if (e.target.name in f) { f[e.target.name] = e.target.value; recargar(); } });
  on(root, 'click', '[data-mas]', () => { limite += 200; cargar(); });
  on(root, 'click', '[data-act="ver"]', (e, el) => verTicket(el.dataset.id, { puedeImprimir: can('tickets.imprimir') }));
  on(root, 'click', '[data-act="imp"]', (e, el) => imprimirPorId(el.dataset.id));
  await cargar();
}
