// Cobro rápido: buscar matrícula -> ver información -> registrar pago -> ticket.
import { get, post } from './api.js';
import {
  html, raw, setHTML, $, on, debounce, money, fdate, badge, estadoMens, initials, toast, modal, modalAbierto,
  spinner, hoyISO, enviarForm,
} from './ui.js';
import { state, can } from './state.js';
import { imprimirTicket, pdfURL, ticketPreview } from './ticket.js';

// Ctrl+P imprime el último ticket (solo en pantallas de cobro o si el aviso de pago está abierto)
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'p') return;
  const ruta = location.hash.replace(/^#\/?/, '').split('?')[0];
  const enCobro = ['', 'inicio', 'cobro'].includes(ruta);
  if (state.ultimoTicket && (enCobro || document.querySelector('.modal.pago-ok'))) {
    e.preventDefault();
    imprimirTicket(state.ultimoTicket);
  }
});

const avatar = (a, cls = '') =>
  a.foto ? html`<img class="avatar ${cls}" src="${a.foto}" alt="">` : html`<div class="avatar ${cls}">${initials(a.nombre_completo)}</div>`;

export function tarjetaCobro(r) {
  const a = r.alumno;
  const c = r.curso_actual;
  const np = r.proximo_pago;
  const activas = r.inscripciones.filter((i) => i.estado === 'activa');
  const aviso = a.estado === 'baja' || a.estado === 'suspendido'
    ? html`<div class="alert rojo">Este alumno está <b>${a.estado === 'baja' ? 'dado de baja' : 'suspendido'}</b>.</div>` : '';
  return html`<div class="cobro-card est-${r.estado_pago}">
    ${aviso}
    <div class="cc-top">
      ${avatar(a, 'lg')}
      <div class="cc-id">
        <div class="cc-label">ALUMNO</div>
        <div class="cc-nombre">${a.nombre_completo}</div>
        <div class="cc-mat"><span class="mono">${a.matricula}</span> · ${a.plantel || 'Sin plantel'}</div>
      </div>
      <div class="cc-estado">${badge('pago', r.estado_pago, { dot: true })}</div>
    </div>
    <div class="cc-grid">
      <div><label>CURSO</label><b>${c ? c.curso : 'Sin curso activo'}</b>${activas.length > 1 ? html`<small>+${activas.length - 1} curso(s) activo(s) más</small>` : ''}</div>
      <div><label>PLANTEL</label><b>${c ? (c.plantel || '—') : (a.plantel || '—')}</b></div>
      <div><label>FECHA DE INICIO</label><b>${c ? fdate(c.fecha_inicio) : '—'}</b></div>
      <div><label>FECHA DE TERMINACIÓN</label><b>${c ? fdate(c.fecha_fin) : '—'}</b></div>
      <div><label>MENSUALIDAD</label><b>${c ? money(c.mensualidad) : '—'}</b></div>
      <div><label>ÚLTIMO PAGO</label><b>${r.ultimo_pago ? money(r.ultimo_pago.importe) : '—'}</b>
        ${r.ultimo_pago ? html`<small>${fdate(r.ultimo_pago.fecha)} · ${r.ultimo_pago.concepto} · Ticket ${r.ultimo_pago.ticket}</small>` : ''}</div>
      <div><label>PRÓXIMO PAGO</label><b>${np ? fdate(np.fecha_limite) : '—'}</b>
        ${np ? html`<small>${np.etiqueta} · saldo ${money(np.saldo)}</small>` : ''}</div>
      <div class="saldo ${r.saldo_pendiente > 0 ? 'rojo' : ''}"><label>SALDO PENDIENTE</label><b>${money(r.saldo_pendiente)}</b>
        <small>Total por pagar del curso: ${money(r.saldo_total)}</small></div>
    </div>
    <div class="cc-actions">
      ${can('pagos.registrar') ? html`<button class="btn primary xl" data-pagar ${raw(r.pendientes.length ? '' : 'disabled')}>REGISTRAR PAGO</button>` : ''}
      ${can('alumnos.ver') ? html`<a class="btn xl" href="#/alumno/${a.id}">VER EXPEDIENTE</a>` : ''}
    </div>
    ${!r.pendientes.length ? html`<p class="muted center">No hay cargos pendientes para este alumno.</p>` : ''}
  </div>`;
}

export function montarCobro(root, { inicial = '', onCambio } = {}) {
  setHTML(root, html`<div class="cobro">
    <div class="cobro-head">
      <h2>COBRO RÁPIDO</h2>
      <span class="atajos">ENTER buscar · ENTER otra vez = pagar · ESC cancelar · CTRL+P imprimir</span>
    </div>
    <label class="cc-label" for="cobro-mat">BUSCAR POR MATRÍCULA</label>
    <form class="cobro-bar" autocomplete="off">
      <input id="cobro-mat" class="mono" name="mat" placeholder="Ej. EA8067" autocapitalize="characters" spellcheck="false" maxlength="40" autofocus>
      <button class="btn primary xl">BUSCAR</button>
    </form>
    <div class="sugerencias" hidden></div>
    <div class="cobro-res"></div>
  </div>`);
  const input = $('#cobro-mat', root);
  const form = $('form', root);
  const sug = $('.sugerencias', root);
  const res = $('.cobro-res', root);
  let actual = null;
  let seq = 0;

  function reset() {
    actual = null;
    input.value = '';
    sug.hidden = true;
    setHTML(res, '');
    input.focus();
    onCambio && onCambio(null);
  }

  async function buscar(mat) {
    mat = (mat || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!mat) { input.focus(); return; }
    const mi = ++seq;
    sug.hidden = true;
    setHTML(res, spinner());
    try {
      const r = await get('/cobro/' + encodeURIComponent(mat));
      if (mi !== seq) return;
      actual = r;
      input.value = r.alumno.matricula;
      setHTML(res, tarjetaCobro(r));
      input.select();
      onCambio && onCambio(r);
    } catch (e) {
      if (mi !== seq) return;
      actual = null;
      if (e.status === 404) {
        setHTML(res, html`<div class="alert amarillo"><b>No se encontró la matrícula ${mat}.</b> Revisa que esté bien escrita o busca por nombre.</div>`);
        sugerir(mat, true);
      } else {
        setHTML(res, html`<div class="alert rojo">${e.message}</div>`);
      }
    }
  }

  async function sugerir(q, forzar = false) {
    q = q.trim();
    const mi = seq;
    if (q.length < 2) { sug.hidden = true; return; }
    try {
      const lista = await get('/alumnos/buscar', { q });
      if (mi !== seq || (!forzar && input.value.trim() !== q)) return;
      if (!lista.length) { sug.hidden = true; return; }
      setHTML(sug, html`${lista.map((a) => html`<button type="button" data-mat="${a.matricula}" class="sug">
        <span class="mono">${a.matricula}</span><span>${a.nombre_completo}</span>${a.estado !== 'activo' ? badge('alumno', a.estado) : ''}</button>`)}`);
      sug.hidden = false;
    } catch { sug.hidden = true; }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim().toUpperCase();
    if (actual && v === actual.alumno.matricula && can('pagos.registrar') && actual.pendientes.length) {
      pagar(); // segundo ENTER sobre la misma matrícula abre el pago
    } else {
      buscar(v);
    }
  });
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    if (actual && input.value.trim() !== actual.alumno.matricula) { actual = null; setHTML(res, ''); onCambio && onCambio(null); }
    sugerir(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !sug.hidden) { e.preventDefault(); $('.sug', sug)?.focus(); }
  });
  sug.addEventListener('keydown', (e) => {
    const b = e.target.closest('.sug');
    if (!b) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (b.nextElementSibling || b).focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (b.previousElementSibling || input).focus(); }
  });
  on(sug, 'click', '.sug', (e, el) => buscar(el.dataset.mat));
  on(res, 'click', '[data-pagar]', () => pagar());
  document.addEventListener('keydown', function f(e) {
    if (!document.body.contains(root)) { document.removeEventListener('keydown', f); return; }
    if ((e.key === 'F2' || (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) && !modalAbierto()) {
      e.preventDefault(); input.focus(); input.select();
    }
  });

  function pagar(mensualidadId) {
    if (!actual) return;
    abrirPago(actual, {
      mensualidadId,
      onPagado: () => buscar(actual.alumno.matricula),
      onNuevo: () => reset(),
    });
  }

  if (inicial) { input.value = inicial; buscar(inicial); }
  return { buscar, reset, pagar };
}

// ---------------------------------------------------------------- registrar pago
export function abrirPago(r, { mensualidadId, onPagado, onNuevo } = {}) {
  const pend = r.pendientes;
  if (!pend.length) { toast('No hay cargos pendientes', 'info'); return; }
  const inicial = pend.find((p) => p.id === mensualidadId) || pend[0];
  const metodos = r.metodos_pago;
  const m = modal({
    titulo: 'Registrar pago', ancho: 'md', clase: 'pago-form',
    cuerpo: html`<form class="form">
      <div class="pago-quien">
        <div><b>${r.alumno.nombre_completo}</b></div>
        <div class="muted"><span class="mono">${r.alumno.matricula}</span> · ${r.alumno.plantel || ''}</div>
      </div>
      <label class="field"><span>CONCEPTO</span>
        <select name="mensualidad_id" data-num>
          ${pend.map((p) => html`<option value="${p.id}" ${raw(p.id === inicial.id ? 'selected' : '')}>${p.etiqueta} · ${p.curso} · vence ${fdate(p.fecha_limite)} · saldo ${money(p.saldo)}</option>`)}
        </select></label>
      <div class="pago-row">
        <label class="field grow"><span>IMPORTE</span>
          <input name="importe" type="number" step="0.01" min="0.01" inputmode="decimal" class="importe-input" required autofocus></label>
        <button type="button" class="btn" data-total>Saldo completo</button>
      </div>
      <div class="pago-info"><span>Saldo del concepto: <b data-saldo></b></span><span>Saldo después del pago: <b data-resta></b></span></div>
      <div class="field"><span>MÉTODO</span>
        <div class="seg">${metodos.map((mt, i) => html`<label class="seg-op"><input type="radio" name="metodo" value="${mt}" ${raw(i === 0 ? 'checked' : '')}><span>${mt}</span></label>`)}</div></div>
      <label class="field" data-ref hidden><span>REFERENCIA (opcional)</span><input name="referencia" maxlength="80" placeholder="Folio, últimos 4 dígitos…"></label>
      ${can('mensualidades.editar') ? html`<label class="field"><span>FECHA DEL PAGO</span><input type="date" name="fecha" value="${hoyISO()}" max="${hoyISO()}"></label>` : ''}
      <div class="form-error" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn lg" data-close>Cancelar <kbd>Esc</kbd></button>
        <button class="btn primary lg">CONFIRMAR PAGO <kbd>Enter</kbd></button>
      </div>
    </form>`,
  });
  const f = $('form', m.body);
  const sel = f.mensualidad_id;
  const importe = f.importe;
  const por = (id) => pend.find((p) => p.id === Number(id));
  const refresca = (llenar) => {
    const p = por(sel.value);
    if (llenar) importe.value = p.saldo;
    $('[data-saldo]', f).textContent = money(p.saldo);
    const resta = Math.round((p.saldo - Number(importe.value || 0)) * 100) / 100;
    const el = $('[data-resta]', f);
    el.textContent = money(Math.max(resta, 0));
    el.classList.toggle('rojo-t', resta < 0);
    importe.max = p.saldo;
  };
  refresca(true);
  importe.select();
  sel.addEventListener('change', () => refresca(true));
  importe.addEventListener('input', () => refresca(false));
  on(f, 'click', '[data-total]', () => { refresca(true); importe.focus(); });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'metodo') $('[data-ref]', f).hidden = e.target.value === 'Efectivo';
  });
  enviarForm(f, async (d) => {
    const resp = await post('/pagos', {
      mensualidad_id: d.mensualidad_id, importe: d.importe, metodo: d.metodo,
      referencia: d.referencia || null, fecha: d.fecha && d.fecha !== hoyISO() ? d.fecha : null,
    });
    m.close();
    mostrarExito(resp.ticket, { onPagado, onNuevo });
  });
}

function mostrarExito(ticket, { onPagado, onNuevo }) {
  state.ultimoTicket = ticket;
  let hecho = false;
  const ok = modal({
    titulo: '', ancho: 'sm', cerrable: true, clase: 'pago-ok',
    onClose: () => { if (!hecho) { hecho = true; onPagado && onPagado(); } },
    cuerpo: html`<div class="exito">
      <div class="check">✓</div>
      <h3>PAGO REGISTRADO CORRECTAMENTE</h3>
      <div class="exito-num">TICKET No. ${ticket.numero_texto}</div>
      <div class="exito-det">${ticket.alumno} · ${ticket.concepto} · <b>${money(ticket.importe)}</b></div>
      ${ticketPreview(ticket)}
      <div class="exito-btns">
        <button class="btn primary xl" data-imprimir autofocus>IMPRIMIR TICKET <kbd>Ctrl+P</kbd></button>
        <a class="btn xl" href="${pdfURL(ticket.id)}" target="_blank" rel="noopener">DESCARGAR PDF</a>
        <button class="btn xl" data-nuevo>NUEVO PAGO</button>
      </div></div>`,
  });
  on(ok.body, 'click', '[data-imprimir]', () => imprimirTicket(ticket));
  on(ok.body, 'click', '[data-nuevo]', () => { hecho = true; ok.close(); onNuevo ? onNuevo() : (onPagado && onPagado()); });
  return ok;
}
