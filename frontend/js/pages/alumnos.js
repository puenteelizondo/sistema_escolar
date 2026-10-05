import { get, post, put } from '../api.js';
import {
  html, raw, setHTML, $, $$, on, debounce, money, fdate, fdatetime, badge, estadoMens, tabla, iconBtn, modal, toast,
  campo, selector, areaTexto, enviarForm, confirmar, pedirTexto, initials, capturarFoto, hoyISO,
} from '../ui.js';
import { can, isAdmin } from '../state.js';
import { planteles, ESTADOS_ALUMNO } from '../catalog.js';
import { abrirPago } from '../cobro.js';
import { verTicket, imprimirPorId, pdfURL } from '../ticket.js';
import { abrirInscribir } from './cursos.js';

const avatar = (a, cls = '') =>
  (a.foto || a.foto_url) ? html`<img class="avatar ${cls}" src="${a.foto || a.foto_url}" alt="" loading="lazy">` : html`<div class="avatar ${cls}">${initials(a.nombre_completo)}</div>`;

// ---------------------------------------------------------------- lista
export async function alumnos(root, ctx) {
  const pl = await planteles();
  const f = { q: ctx.params.get('q') || '', estado: ctx.params.get('estado') || '', plantel_id: '', pago: ctx.params.get('pago') || '' };
  let limite = 50;
  setHTML(root, html`<div class="card">
    <div class="toolbar">
      <input class="grow" type="search" name="q" placeholder="Buscar por matrícula, nombre, teléfono o curso…" value="${f.q}" autofocus>
      ${selector('', 'estado', ESTADOS_ALUMNO, f.estado, { vacio: 'Todos los estados', clase: 'inline' })}
      ${selector('', 'pago', [['al_corriente', 'Al corriente'], ['por_vencer', 'Próximo a vencer'], ['vencido', 'Vencido'], ['sin_curso', 'Sin curso activo']], f.pago, { vacio: 'Estado de pago', clase: 'inline' })}
      ${selector('', 'plantel_id', pl.map((p) => [p.id, p.nombre]), '', { vacio: 'Todos los planteles', clase: 'inline' })}
      ${can('alumnos.crear') ? html`<button class="btn primary" data-nuevo>+ NUEVO ALUMNO</button>` : ''}
    </div>
    <div id="lista"></div></div>`);
  const lista = $('#lista', root);

  async function cargar() {
    const r = await get('/alumnos', { ...f, limit: limite });
    setHTML(lista, html`${tabla([
      { label: 'Matrícula', render: (a) => html`<a class="mono strong" href="#/alumno/${a.id}">${a.matricula}</a>` },
      { label: 'Alumno', render: (a) => html`<div class="celda-al">${avatar(a, 'sm')}<span>${a.nombre_completo}</span></div>` },
      { label: 'Plantel', key: 'plantel' },
      { label: 'Curso activo', render: (a) => a.cursos_activos.join(', ') || html`<span class="muted">—</span>` },
      { label: 'Teléfono', render: (a) => a.telefono || a.whatsapp || '—' },
      ...(can('pagos.ver') ? [{ label: 'Pago', render: (a) => a.estado === 'baja' ? '' : badge('pago', a.estado_pago, { dot: true }) }] : []),
      { label: 'Estado', render: (a) => badge('alumno', a.estado) },
      { label: '', cls: 'acc', render: (a) => html`<a class="btn sm" href="#/alumno/${a.id}">Expediente</a>
        ${can('pagos.registrar') && a.estado !== 'baja' ? html`<a class="btn sm primary" href="#/cobro?m=${a.matricula}">Cobrar</a>` : ''}` },
    ], r.items, { vacio: 'No se encontraron alumnos con esos filtros.' })}
    <div class="pager"><span>${r.items.length} de ${r.total} alumno(s)</span>
      ${r.total > r.items.length ? html`<button class="btn" data-mas>Mostrar más</button>` : ''}</div>`);
  }
  const recargar = debounce(() => { limite = 50; cargar().catch((e) => toast(e.message, 'error')); }, 250);
  root.addEventListener('input', (e) => {
    if (e.target.name in f) { f[e.target.name] = e.target.value; recargar(); }
  });
  on(root, 'click', '[data-mas]', () => { limite += 100; cargar(); });
  on(root, 'click', '[data-nuevo]', () => formAlumno(null, (a) => { location.hash = `#/alumno/${a.id}`; }));
  await cargar();
}

// ---------------------------------------------------------------- formulario
export async function formAlumno(a, onSaved) {
  const pl = await planteles();
  const nuevo = !a;
  let auto = '';
  if (nuevo) { try { auto = (await get('/alumnos/siguiente-matricula')).matricula; } catch { /* opcional */ } }
  const m = modal({
    titulo: nuevo ? 'Nuevo alumno' : `Editar alumno · ${a.matricula}`, ancho: 'lg',
    cuerpo: html`<form class="form">
      <div class="foto-row">
        <div class="foto-prev" data-prev>${a && a.foto ? html`<img src="${a.foto}" alt="">` : initials(a ? a.nombre_completo : '+')}</div>
        <button type="button" class="btn sm" data-foto>📷 Tomar / subir fotografía</button>
        ${a && a.foto ? html`<button type="button" class="btn sm danger-o" data-quitar>Quitar foto</button>` : ''}
        <input type="hidden" name="foto">
      </div>
      <div class="form-grid">
        ${campo('Matrícula', 'matricula', a ? a.matricula : '', {
          attrs: `placeholder="${nuevo ? `Automática: ${auto}` : ''}" style="text-transform:uppercase" maxlength="20" ${a && !isAdmin() ? 'readonly' : ''}`,
          ayuda: nuevo ? 'Déjala vacía para usar la siguiente matrícula automática.' : (isAdmin() ? 'Cámbiala solo si es necesario; debe ser única.' : ''),
        })}
        ${campo('Fecha de inscripción', 'fecha_inscripcion', a ? a.fecha_inscripcion : hoyISO(), { tipo: 'date' })}
        ${campo('Nombre(s)', 'nombre', a ? a.nombre : '', { requerido: true, attrs: 'maxlength="80"' })}
        ${campo('Apellido paterno', 'apellido_paterno', a ? a.apellido_paterno : '', { requerido: true, attrs: 'maxlength="80"' })}
        ${campo('Apellido materno', 'apellido_materno', a ? a.apellido_materno : '', { attrs: 'maxlength="80"' })}
        ${campo('Fecha de nacimiento', 'fecha_nacimiento', a ? a.fecha_nacimiento : '', { tipo: 'date' })}
        ${campo('Teléfono', 'telefono', a ? a.telefono : '', { tipo: 'tel' })}
        ${campo('WhatsApp', 'whatsapp', a ? a.whatsapp : '', { tipo: 'tel' })}
        ${campo('Correo', 'correo', a ? a.correo : '', { tipo: 'email' })}
        ${selector('Plantel', 'plantel_id', pl.filter((p) => p.activo || (a && a.plantel_id === p.id)).map((p) => [p.id, p.nombre]), a ? a.plantel_id : '', { vacio: '— Sin plantel —', attrs: 'data-num' })}
        ${campo('Dirección', 'direccion', a ? a.direccion : '', { clase: 'span2' })}
        ${campo('Contacto de emergencia', 'contacto_emergencia', a ? a.contacto_emergencia : '')}
        ${campo('Teléfono de emergencia', 'telefono_emergencia', a ? a.telefono_emergencia : '', { tipo: 'tel' })}
        ${!nuevo && can('alumnos.editar') ? selector('Estado', 'estado', ESTADOS_ALUMNO, a.estado) : ''}
      </div>
      <div class="form-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">${nuevo ? 'CREAR ALUMNO' : 'GUARDAR CAMBIOS'}</button></div></form>`,
  });
  const form = $('form', m.body);
  const prev = $('[data-prev]', m.body);
  $('[data-foto]', m.body).addEventListener('click', async () => {
    const url = await capturarFoto(320);
    if (!url) return;
    form.foto.value = url;
    setHTML(prev, html`<img src="${url}" alt="">`);
  });
  const q = $('[data-quitar]', m.body);
  if (q) q.addEventListener('click', async () => {
    try {
      await put(`/alumnos/${a.id}/foto`, { foto: null });
      form.foto.value = '';
      setHTML(prev, initials(a.nombre_completo));
      q.remove();
      a.foto = null;
      toast('Foto quitada');
      onSaved && onSaved(a);
    } catch (err) { toast(err.message, 'error'); }
  });
  enviarForm(form, async (d) => {
    const body = { ...d, matricula: d.matricula ? d.matricula.toUpperCase() : null };
    if (!body.fecha_inscripcion) delete body.fecha_inscripcion;
    const r = nuevo ? await post('/alumnos', body) : await put(`/alumnos/${a.id}`, body);
    m.close();
    toast(nuevo ? `Alumno creado · matrícula ${r.matricula}` : 'Cambios guardados');
    onSaved && onSaved(r);
  });
}

// ---------------------------------------------------------------- expediente
export async function expediente(root, ctx) {
  const id = ctx.args[0];
  const r = await get(`/alumnos/${id}/expediente`);
  const a = r.alumno;
  ctx.titulo(`Expediente · ${a.matricula}`);
  const verPagos = can('pagos.ver');
  const np = r.proximo_pago;
  const activa = r.inscripciones.filter((i) => i.estado !== 'retirada');

  setHTML(root, html`<div class="exp">
    <section class="card exp-head">
      <div class="exp-foto">${avatar(a, 'xl')}${can('alumnos.editar') ? html`<button class="btn sm" data-foto-exp>📷 ${a.foto ? 'Cambiar foto' : 'Agregar foto'}</button>` : ''}</div>
      <div class="exp-id">
        <div class="cc-label">ALUMNO</div>
        <h2>${a.nombre_completo}</h2>
        <div class="exp-sub"><span class="mono strong">${a.matricula}</span> · ${a.plantel || 'Sin plantel'}
          ${badge('alumno', a.estado)} ${a.estado !== 'baja' && verPagos ? badge('pago', r.estado_pago, { dot: true }) : ''}</div>
        <dl class="datos">
          <div><dt>Teléfono</dt><dd>${a.telefono || '—'}</dd></div>
          <div><dt>WhatsApp</dt><dd>${a.whatsapp || '—'}</dd></div>
          <div><dt>Correo</dt><dd>${a.correo || '—'}</dd></div>
          <div><dt>Nacimiento</dt><dd>${fdate(a.fecha_nacimiento)}</dd></div>
          <div><dt>Inscripción</dt><dd>${fdate(a.fecha_inscripcion)}</dd></div>
          <div class="wide"><dt>Dirección</dt><dd>${a.direccion || '—'}</dd></div>
          <div class="wide"><dt>Emergencia</dt><dd>${a.contacto_emergencia || '—'} ${a.telefono_emergencia ? `· ${a.telefono_emergencia}` : ''}</dd></div>
        </dl>
      </div>
      <div class="exp-btns">
        ${can('pagos.registrar') && a.estado !== 'baja' ? html`<a class="btn primary" href="#/cobro?m=${a.matricula}">Cobrar</a>` : ''}
        ${can('inscripciones.admin') && a.estado !== 'baja' ? html`<button class="btn" data-insc>Inscribir a curso</button>` : ''}
        ${can('alumnos.editar') ? html`<button class="btn" data-edit>Editar</button>` : ''}
        ${can('alumnos.baja') ? (a.estado === 'baja' ? html`<button class="btn" data-react>Reactivar</button>` : html`<button class="btn danger-o" data-baja>Dar de baja</button>`) : ''}
      </div>
    </section>

    ${verPagos ? html`<section class="stats mini">
      <div class="stat ${r.estado_pago === 'vencido' ? 'rojo' : r.estado_pago === 'por_vencer' ? 'amarillo' : 'verde'}"><div class="stat-t">ESTADO DE PAGO</div><div class="stat-v sm">${badge('pago', r.estado_pago, { dot: true })}</div></div>
      <div class="stat ${r.saldo_pendiente > 0 ? 'rojo' : 'azul'}"><div class="stat-t">SALDO PENDIENTE</div><div class="stat-v">${money(r.saldo_pendiente)}</div><div class="stat-s">Por pagar en total: ${money(r.saldo_total)}</div></div>
      <div class="stat azul"><div class="stat-t">PRÓXIMO PAGO</div><div class="stat-v">${np ? fdate(np.fecha_limite) : '—'}</div><div class="stat-s">${np ? `${np.etiqueta} · ${money(np.saldo)}` : 'Sin cargos pendientes'}</div></div>
      <div class="stat azul"><div class="stat-t">ÚLTIMO PAGO</div><div class="stat-v">${r.ultimo_pago ? money(r.ultimo_pago.importe) : '—'}</div><div class="stat-s">${r.ultimo_pago ? `${fdate(r.ultimo_pago.fecha)} · Ticket ${r.ultimo_pago.ticket}` : ''}</div></div>
    </section>` : ''}

    <section class="card"><h3>Cursos e inscripciones <small class="muted">(${r.inscripciones.length})</small></h3>
      ${r.inscripciones.length ? r.inscripciones.map((i) => cardInscripcion(i, verPagos)) : html`<div class="empty">Este alumno aún no está inscrito en ningún curso.</div>`}
    </section>

    ${verPagos ? html`<section class="card"><h3>Historial de pagos</h3>${tabla([
      { label: 'Ticket', render: (p) => html`<b class="mono">${p.ticket || '—'}</b>` },
      { label: 'Fecha', render: (p) => fdate(p.fecha) },
      { label: 'Concepto', render: (p) => html`${p.concepto}<small class="block muted">${p.curso}</small>` },
      { label: 'Importe', cls: 'num', render: (p) => money(p.importe) },
      { label: 'Método', key: 'metodo' },
      { label: 'Cobró', key: 'usuario' },
      { label: 'Estado', render: (p) => html`${badge('pagoreg', p.estado)}${p.motivo_cancelacion ? html`<small class="block muted">${p.motivo_cancelacion}</small>` : ''}` },
      { label: '', cls: 'acc', render: (p) => p.ticket_id && can('tickets.ver') ? html`${iconBtn('ticket', p.ticket_id, 'Ver')}${can('tickets.imprimir') ? iconBtn('imp', p.ticket_id, 'Imprimir') : ''}` : '' },
    ], r.pagos, { vacio: 'Sin pagos registrados.' })}</section>` : ''}

    ${r.bitacora.length ? html`<section class="card"><details><summary><h3 class="inline">Historial de actividad</h3></summary>
      ${tabla([
        { label: 'Fecha', render: (l) => fdatetime(l.fecha) }, { label: 'Usuario', key: 'usuario' },
        { label: 'Acción', render: (l) => l.accion.replaceAll('_', ' ') }, { label: 'Detalle', key: 'detalle' },
      ], r.bitacora)}</details></section>` : ''}
  </div>`);

  const refrescar = () => ctx.refrescar();
  on(root, 'click', '[data-edit]', () => formAlumno(a, refrescar));
  on(root, 'click', '[data-foto-exp]', async () => {
    const url = await capturarFoto(320);
    if (!url) return;
    try { await put(`/alumnos/${a.id}/foto`, { foto: url }); toast('Foto guardada'); refrescar(); } catch (err) { toast(err.message, 'error'); }
  });
  on(root, 'click', '[data-insc]', () => abrirInscribir({ alumno: a, onDone: refrescar }));
  on(root, 'click', '[data-baja]', async () => {
    const motivo = await pedirTexto({ titulo: 'Dar de baja', mensaje: `¿Dar de baja a ${a.nombre_completo}? Su historial (pagos, tickets, cursos y asistencias) se conserva.`, etiqueta: 'Motivo de la baja', si: 'Dar de baja', peligro: true });
    if (motivo === null) return;
    try { await post(`/alumnos/${a.id}/baja`, { motivo }); toast('Alumno dado de baja'); refrescar(); } catch (e) { toast(e.message, 'error'); }
  });
  on(root, 'click', '[data-react]', async () => {
    if (!(await confirmar({ titulo: 'Reactivar alumno', mensaje: `¿Reactivar a ${a.nombre_completo}?`, si: 'Reactivar' }))) return;
    try { await post(`/alumnos/${a.id}/reactivar`); toast('Alumno reactivado'); refrescar(); } catch (e) { toast(e.message, 'error'); }
  });
  on(root, 'click', '[data-act="ticket"]', (e, el) => verTicket(el.dataset.id, { puedeImprimir: can('tickets.imprimir') }));
  on(root, 'click', '[data-act="imp"]', (e, el) => imprimirPorId(el.dataset.id));
  on(root, 'click', '[data-act="pagar"]', (e, el) => abrirPago(r, { mensualidadId: Number(el.dataset.id), onPagado: refrescar, onNuevo: refrescar }));
  on(root, 'click', '[data-act="editmens"]', (e, el) => {
    const mens = r.inscripciones.flatMap((i) => i.mensualidades).find((x) => x.id === Number(el.dataset.id));
    editarMensualidad(mens, refrescar);
  });
  on(root, 'click', '[data-act="retirar"]', async (e, el) => {
    const i = r.inscripciones.find((x) => x.id === Number(el.dataset.id));
    const motivo = await pedirTexto({ titulo: 'Retirar del curso', mensaje: `Se retirará a ${a.nombre_completo} de «${i.curso}». Los cargos sin pagos se cancelan; los pagos hechos se conservan.`, etiqueta: 'Motivo', si: 'Retirar del curso', peligro: true });
    if (motivo === null) return;
    try { const x = await post(`/inscripciones/${i.id}/retirar`, { motivo }); toast(`Retirado (${x.cargos_cancelados} cargo(s) cancelados)`); refrescar(); } catch (er) { toast(er.message, 'error'); }
  });
  on(root, 'click', '[data-act="calendario"]', async (e, el) => {
    try { await post(`/inscripciones/${el.dataset.id}/generar-calendario`); toast('Calendario de pagos generado'); refrescar(); } catch (er) { toast(er.message, 'error'); }
  });
}

function cardInscripcion(i, verPagos) {
  const as = i.asistencia;
  return html`<div class="insc ${i.estado}">
    <div class="insc-head">
      <div><b class="insc-t">${i.curso}</b> <span class="muted">${i.codigo}</span> ${badge('insc', i.estado)}
        <div class="muted">${i.plantel || ''} · ${fdate(i.fecha_inicio)} al ${fdate(i.fecha_fin)} ${verPagos ? html` · Inscripción ${money(i.costo_inscripcion)} · Mensualidad ${money(i.mensualidad)} × ${i.num_mensualidades}` : ''}</div></div>
      <div class="row-btns">
        ${can('cursos.ver') ? html`<a class="btn sm" href="#/curso/${i.curso_id}">Ver curso</a>` : ''}
        ${can('inscripciones.admin') && !i.mensualidades.length && i.estado !== 'retirada' ? html`<button class="btn sm" data-act="calendario" data-id="${i.id}">Generar calendario de pagos</button>` : ''}
        ${can('inscripciones.admin') && i.estado !== 'retirada' ? html`<button class="btn sm danger-o" data-act="retirar" data-id="${i.id}">Retirar del curso</button>` : ''}
      </div>
    </div>
    ${i.estado === 'retirada' ? html`<div class="retiro-info"><b>Retirado del curso</b>${i.fecha_retiro ? html` el ${fdate(i.fecha_retiro)}` : ''}${i.retiro_usuario ? html` · por ${i.retiro_usuario}` : ''}<br>
      <span class="muted">Motivo:</span> ${i.retiro_motivo || 'sin motivo registrado'}</div>` : ''}
    ${as ? html`<div class="asis-line">Asistencia: <b>${as.asistencias}</b> · Faltas: <b>${as.faltas}</b> · Retardos: <b>${as.retardos}</b>${as.justificadas ? html` · Justificadas: <b>${as.justificadas}</b>` : ''}
      · <b>${as.porcentaje}%</b></div>` : ''}
    ${verPagos && i.mensualidades.length ? tabla([
      { label: 'Concepto', key: 'etiqueta' },
      { label: 'Fecha límite', render: (m) => fdate(m.fecha_limite) },
      { label: 'Importe', cls: 'num', render: (m) => money(m.importe) },
      { label: 'Pagado', cls: 'num', render: (m) => money(m.pagado) },
      { label: 'Saldo', cls: 'num', render: (m) => m.cancelada ? '—' : money(m.saldo) },
      { label: 'Estado', render: (m) => html`${badge('mens', estadoMens(m))}${m.dias_atraso ? html`<small class="block muted">${m.dias_atraso} día(s)</small>` : ''}` },
      { label: '', cls: 'acc', render: (m) => html`${can('pagos.registrar') && m.saldo > 0 && !m.cancelada && i.estado !== 'retirada' ? html`<button class="btn sm primary" data-act="pagar" data-id="${m.id}">Pagar</button>` : ''}
        ${can('mensualidades.editar') && !m.cancelada ? html`<button class="btn sm" data-act="editmens" data-id="${m.id}" title="Cambiar fecha o importe">✎</button>` : ''}` },
    ], i.mensualidades.map((m) => ({ ...m, _cls: m.cancelada ? 'tachado' : '' })), { clase: 'compacta' }) : ''}
  </div>`;
}

function editarMensualidad(m, onDone) {
  const mod = modal({
    titulo: `Editar · ${m.etiqueta}`, ancho: 'sm',
    cuerpo: html`<form class="form">
      ${campo('Fecha límite de pago', 'fecha_limite', m.fecha_limite, { tipo: 'date', requerido: true })}
      ${campo('Importe', 'importe', m.importe, { tipo: 'number', requerido: true, attrs: `step="0.01" min="${m.pagado}"`, ayuda: m.pagado ? `Ya se pagaron ${money(m.pagado)}; el importe no puede ser menor.` : '' })}
      <div class="form-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
  });
  enviarForm($('form', mod.body), async (d) => {
    await put(`/mensualidades/${m.id}`, { fecha_limite: d.fecha_limite, importe: d.importe });
    mod.close();
    toast('Cargo actualizado');
    onDone();
  });
}
