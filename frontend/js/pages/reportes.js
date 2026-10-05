import { get } from '../api.js';
import { html, raw, setHTML, $, $$, on, money, fdate, tabla, toast, selector, campo, descargar, spinner, hoyISO } from '../ui.js';
import { can } from '../state.js';
import { planteles } from '../catalog.js';
import { url } from '../api.js';

const ETIQ = {
  fecha: 'Fecha', mes: 'Mes', desde: 'Desde', hasta: 'Hasta', curso_id: 'Curso', plantel_id: 'Plantel',
  usuario_id: 'Usuario', metodo: 'Método de pago', matricula: 'Matrícula', q: 'Buscar',
};

export async function reportes(root) {
  const [pl, cursos, metodos, usuarios, cat] = await Promise.all([
    planteles(), get('/cursos').catch(() => []), get('/metodos-pago').catch(() => []),
    get('/usuarios').catch(() => []), get('/reportes'),
  ]);
  const ff = { curso_id: '', plantel_id: '', usuario_id: '', metodo: '' };
  const filtrosFin = () => html`<div class="toolbar">
    ${selector('', 'curso_id', cursos.map((c) => [c.id, `${c.nombre} (${c.codigo})`]), ff.curso_id, { vacio: 'Todos los cursos', clase: 'inline' })}
    ${selector('', 'plantel_id', pl.map((p) => [p.id, p.nombre]), ff.plantel_id, { vacio: 'Todos los planteles', clase: 'inline' })}
    ${usuarios.length ? selector('', 'usuario_id', usuarios.map((u) => [u.id, u.nombre]), ff.usuario_id, { vacio: 'Todos los usuarios', clase: 'inline' }) : ''}
    ${selector('', 'metodo', metodos, ff.metodo, { vacio: 'Todos los métodos', clase: 'inline' })}
  </div>`;

  setHTML(root, html`<div class="rep">
    <section class="card"><h3>Control financiero</h3>
      <div id="fin-filtros">${filtrosFin()}</div>
      <div class="stats" id="fin"></div></section>
    <section class="card"><h3>Reportes</h3>
      <div class="rep-lista">${cat.map((r, i) => html`<button class="chip-btn ${i === 0 ? 'activo' : ''}" data-rep="${r.key}">${r.nombre}</button>`)}</div>
      <form class="rep-form" id="rep-form"></form>
      <div id="rep-res"></div></section></div>`);

  async function finanzas() {
    const r = await get('/finanzas/resumen', ff);
    setHTML($('#fin', root), html`
      <div class="stat verde"><div class="stat-t">INGRESOS DEL DÍA</div><div class="stat-v">${money(r.dia)}</div></div>
      <div class="stat verde"><div class="stat-t">DE LA SEMANA</div><div class="stat-v">${money(r.semana)}</div></div>
      <div class="stat verde"><div class="stat-t">DEL MES</div><div class="stat-v">${money(r.mes)}</div></div>
      <div class="stat verde"><div class="stat-t">DEL AÑO</div><div class="stat-v">${money(r.anio)}</div></div>
      <div class="stat rojo"><div class="stat-t">TOTAL DE ADEUDOS</div><div class="stat-v">${money(r.total_adeudos)}</div><div class="stat-s">${r.pagos_vencidos} pago(s) vencido(s)</div></div>
      <div class="stat amarillo"><div class="stat-t">PAGOS PENDIENTES</div><div class="stat-v">${money(r.saldo_pendiente)}</div><div class="stat-s">${r.pagos_pendientes} cargo(s) por vencer</div></div>`);
  }
  $('#fin-filtros', root).addEventListener('change', (e) => {
    if (e.target.name in ff) { ff[e.target.name] = e.target.value; finanzas().catch((er) => toast(er.message, 'error')); }
  });

  let actual = cat[0];
  function pintarForm() {
    const campos = actual.filtros.map((k) => {
      if (k === 'curso_id') return selector(ETIQ[k], k, cursos.map((c) => [c.id, `${c.nombre} (${c.codigo})`]), '', { vacio: actual.key === 'asistencia' ? 'Selecciona…' : 'Todos', requerido: actual.key === 'asistencia' });
      if (k === 'plantel_id') return selector(ETIQ[k], k, pl.map((p) => [p.id, p.nombre]), '', { vacio: 'Todos' });
      if (k === 'usuario_id') return usuarios.length ? selector(ETIQ[k], k, usuarios.map((u) => [u.id, u.nombre]), '', { vacio: 'Todos' }) : '';
      if (k === 'metodo') return selector(ETIQ[k], k, metodos, '', { vacio: 'Todos' });
      if (k === 'fecha') return campo(ETIQ[k], k, hoyISO(), { tipo: 'date' });
      if (k === 'mes') return campo(ETIQ[k], k, hoyISO().slice(0, 7), { tipo: 'month' });
      if (k === 'desde' || k === 'hasta') return campo(ETIQ[k], k, '', { tipo: 'date' });
      if (k === 'matricula') return campo(ETIQ[k], k, '', { requerido: true, attrs: 'style="text-transform:uppercase" placeholder="EA8067"' });
      return campo(ETIQ[k] || k, k, '', {});
    });
    setHTML($('#rep-form', root), html`<div class="rep-campos">${campos}</div>
      <div class="rep-btns"><button class="btn primary" data-ver>Ver reporte</button>
        <button type="button" class="btn" data-exp="xlsx">Exportar Excel</button>
        <button type="button" class="btn" data-exp="pdf">Exportar PDF</button></div>`);
  }
  const params = () => {
    const p = {};
    $$('#rep-form [name]', root).forEach((el) => { if (el.value) p[el.name] = el.value; });
    return p;
  };
  async function ver() {
    const form = $('#rep-form', root);
    if (!form.reportValidity()) return;
    const box = $('#rep-res', root);
    setHTML(box, spinner());
    try {
      const r = await get(`/reportes/${actual.key}`, params());
      setHTML(box, html`<h3 class="rep-titulo">${r.titulo}${r.subtitulo ? html` <small class="muted">· ${r.subtitulo}</small>` : ''}</h3>
        ${tabla(r.columnas.map((c) => ({ label: c.label, cls: ['money', 'pct'].includes(c.tipo) ? 'num' : '', render: (f) => fmt(f[c.key], c.tipo) })), r.filas, { vacio: 'Sin resultados para estos filtros.' })}
        <p class="muted">${r.truncado ? `Mostrando los primeros ${r.filas.length} de ${r.total} registros. Descarga el Excel o el PDF para ver todos.` : `${r.total} registro(s)`}</p>
        ${r.resumen && r.resumen.length ? html`<div class="resumen-rep">${r.resumen.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>` : ''}`);
    } catch (e) { setHTML(box, html`<div class="alert rojo">${e.message}</div>`); }
  }
  const fmt = (v, tipo) => {
    if (v === null || v === undefined || v === '') return '';
    if (tipo === 'money') return money(v);
    if (tipo === 'date') return fdate(v);
    if (tipo === 'pct') return `${v}%`;
    return v;
  };
  on(root, 'click', '[data-rep]', (e, el) => {
    actual = cat.find((r) => r.key === el.dataset.rep);
    $$('[data-rep]', root).forEach((b) => b.classList.toggle('activo', b === el));
    pintarForm();
    setHTML($('#rep-res', root), '');
    if (!actual.filtros.some((k) => ['curso_id', 'matricula'].includes(k) && (k === 'matricula' || actual.key === 'asistencia'))) ver();
  });
  on(root, 'click', '[data-ver]', (e) => { e.preventDefault(); ver(); });
  on(root, 'click', '[data-exp]', (e, el) => {
    const form = $('#rep-form', root);
    if (!form.reportValidity()) return;
    const u = url(`/reportes/${actual.key}`, { ...params(), formato: el.dataset.exp });
    if (el.dataset.exp === 'pdf') window.open(u, '_blank', 'noopener'); else descargar(u);
  });
  $('#rep-form', root).addEventListener('submit', (e) => { e.preventDefault(); ver(); });
  pintarForm();
  await Promise.all([finanzas(), ver()]);
}
