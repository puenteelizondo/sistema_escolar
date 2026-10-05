import { get, post, put, del } from '../api.js';
import {
  html, raw, setHTML, $, on, debounce, money, fdate, badge, tabla, modal, toast, campo, selector, areaTexto,
  enviarForm, confirmar, pedirTexto, hoyISO, spinner,
} from '../ui.js';
import { can } from '../state.js';
import { planteles, instructores, AREAS, ESTADOS_CURSO, DIAS, diasTexto, invalidar } from '../catalog.js';

// ---------------------------------------------------------------- lista
export async function cursos(root, ctx) {
  const [pl, ins] = await Promise.all([planteles(), instructores()]);
  const f = { q: '', estado: ctx.params.get('estado') || '', plantel_id: '', instructor_id: '' };
  setHTML(root, html`<div class="card">
    <div class="toolbar">
      <input class="grow" type="search" name="q" placeholder="Buscar curso por nombre o código…">
      ${selector('', 'estado', ESTADOS_CURSO, f.estado, { vacio: 'Todos los estados', clase: 'inline' })}
      ${selector('', 'plantel_id', pl.map((p) => [p.id, p.nombre]), '', { vacio: 'Todos los planteles', clase: 'inline' })}
      ${selector('', 'instructor_id', ins.map((p) => [p.id, p.nombre]), '', { vacio: 'Todos los instructores', clase: 'inline' })}
      ${can('cursos.admin') ? html`<button class="btn primary" data-nuevo>+ NUEVO CURSO</button>` : ''}
    </div><div id="lista"></div></div>`);
  const lista = $('#lista', root);
  async function cargar() {
    const items = await get('/cursos', f);
    setHTML(lista, tabla([
      { label: 'Código', render: (c) => html`<span class="mono">${c.codigo}</span>` },
      { label: 'Curso', render: (c) => html`<a class="strong" href="#/curso/${c.id}">${c.nombre}</a><small class="block muted">${c.area}</small>` },
      { label: 'Plantel', key: 'plantel' },
      { label: 'Instructor', render: (c) => c.instructor || '—' },
      { label: 'Fechas', render: (c) => html`${fdate(c.fecha_inicio)} → ${fdate(c.fecha_fin)}` },
      { label: 'Inscritos', cls: 'num', render: (c) => html`${c.inscritos}<span class="muted">/${c.cupo_maximo}</span>` },
      ...(can('pagos.ver') ? [{ label: 'Mensualidad', cls: 'num', render: (c) => money(c.costo_mensualidad) }] : []),
      { label: 'Estado', render: (c) => badge('curso', c.estado) },
      { label: '', cls: 'acc', render: (c) => html`<a class="btn sm" href="#/curso/${c.id}">Abrir</a>` },
    ], items, { vacio: 'No hay cursos con esos filtros.' }));
  }
  const recargar = debounce(() => cargar().catch((e) => toast(e.message, 'error')), 250);
  root.addEventListener('input', (e) => { if (e.target.name in f) { f[e.target.name] = e.target.value; recargar(); } });
  on(root, 'click', '[data-nuevo]', () => formCurso(null, (c) => { location.hash = `#/curso/${c.id}`; }));
  await cargar();
}

// ---------------------------------------------------------------- formulario de curso
export async function formCurso(c, onSaved) {
  const [pl, ins] = await Promise.all([planteles(), instructores()]);
  const dias = new Set((c && c.dias_clase ? c.dias_clase : '').split(',').filter(Boolean));
  const m = modal({
    titulo: c ? `Editar curso · ${c.codigo}` : 'Nuevo curso', ancho: 'lg',
    cuerpo: html`<form class="form">
      <div class="form-grid">
        ${campo('Nombre del curso', 'nombre', c ? c.nombre : '', { requerido: true, clase: 'span2', attrs: 'maxlength="150" placeholder="Ej. Mecánica Automotriz 2026-B"' })}
        ${campo('Código del curso', 'codigo', c ? c.codigo : '', { requerido: true, attrs: 'maxlength="30" placeholder="MEC-001"' })}
        ${selector('Área', 'area', AREAS, c ? c.area : AREAS[0], { requerido: true })}
        ${selector('Plantel', 'plantel_id', pl.filter((p) => p.activo || (c && c.plantel_id === p.id)).map((p) => [p.id, p.nombre]), c ? c.plantel_id : '', { vacio: '— Sin plantel —', attrs: 'data-num' })}
        ${selector('Instructor', 'instructor_id', ins.filter((p) => p.activo || (c && c.instructor_id === p.id)).map((p) => [p.id, p.nombre]), c ? c.instructor_id : '', { vacio: '— Sin instructor —', attrs: 'data-num' })}
        ${campo('Fecha de inicio', 'fecha_inicio', c ? c.fecha_inicio : hoyISO(), { tipo: 'date', requerido: true })}
        ${campo('Fecha de terminación', 'fecha_fin', c ? c.fecha_fin : '', { tipo: 'date', requerido: true })}
        <div class="field span2"><span>Días de clase</span>
          <div class="chips">${DIAS.map(([k, l]) => html`<label class="chip"><input type="checkbox" name="dia_${k}" ${raw(dias.has(k) ? 'checked' : '')}><span>${l}</span></label>`)}</div></div>
        ${campo('Horario', 'horario', c ? c.horario : '', { attrs: 'placeholder="18:00 - 21:00"' })}
        ${campo('Duración', 'duracion', c ? c.duracion : '', { attrs: 'placeholder="6 meses"' })}
        ${campo('Cupo máximo', 'cupo_maximo', c ? c.cupo_maximo : 30, { tipo: 'number', requerido: true, attrs: 'min="1" max="500"' })}
        ${selector('Estado', 'estado', ESTADOS_CURSO, c ? c.estado : 'proximo', { requerido: true })}
        ${campo('Costo de inscripción ($)', 'costo_inscripcion', c ? c.costo_inscripcion : 0, { tipo: 'number', requerido: true, attrs: 'min="0" step="0.01"' })}
        ${campo('Costo de mensualidad ($)', 'costo_mensualidad', c ? c.costo_mensualidad : 0, { tipo: 'number', requerido: true, attrs: 'min="0" step="0.01"' })}
        ${campo('Número de mensualidades', 'num_mensualidades', c ? c.num_mensualidades : 6, { tipo: 'number', requerido: true, attrs: 'min="0" max="60"' })}
        ${areaTexto('Descripción', 'descripcion', c ? c.descripcion : '', { clase: 'span2', filas: 2 })}
      </div>
      ${c && c.inscritos ? html`<div class="alert azul">Los cambios de precio y fechas solo afectan a <b>nuevas inscripciones</b>; los alumnos ya inscritos conservan lo pactado (puedes ajustar sus cargos desde su expediente).</div>` : ''}
      <div class="form-error" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">${c ? 'GUARDAR CAMBIOS' : 'CREAR CURSO'}</button></div></form>`,
  });
  enviarForm($('form', m.body), async (d) => {
    const dias_clase = DIAS.map(([k]) => k).filter((k) => d[`dia_${k}`]).join(',') || null;
    for (const [k] of DIAS) delete d[`dia_${k}`];
    const r = c ? await put(`/cursos/${c.id}`, { ...d, dias_clase }) : await post('/cursos', { ...d, dias_clase });
    invalidar();
    m.close();
    toast(c ? 'Curso actualizado' : 'Curso creado');
    onSaved && onSaved(r);
  });
}

// ---------------------------------------------------------------- detalle
export async function cursoDetalle(root, ctx) {
  const c = await get(`/cursos/${ctx.args[0]}`);
  ctx.titulo(`Curso · ${c.codigo}`);
  const verPagos = can('pagos.ver');
  const refrescar = () => ctx.refrescar();
  const activos = c.alumnos.filter((a) => a.estado_inscripcion !== 'retirada');
  setHTML(root, html`<div class="exp">
    <section class="card exp-head">
      <div class="exp-id">
        <div class="cc-label">${c.area.toUpperCase()} · <span class="mono">${c.codigo}</span></div>
        <h2>${c.nombre} ${badge('curso', c.estado)}</h2>
        ${c.descripcion ? html`<p class="muted">${c.descripcion}</p>` : ''}
        <dl class="datos">
          <div><dt>Plantel</dt><dd>${c.plantel || '—'}</dd></div>
          <div><dt>Instructor</dt><dd>${c.instructor || '—'}</dd></div>
          <div><dt>Inicio</dt><dd>${fdate(c.fecha_inicio)}</dd></div>
          <div><dt>Terminación</dt><dd>${fdate(c.fecha_fin)}</dd></div>
          <div><dt>Días de clase</dt><dd>${diasTexto(c.dias_clase)}</dd></div>
          <div><dt>Horario</dt><dd>${c.horario || '—'}</dd></div>
          <div><dt>Duración</dt><dd>${c.duracion || '—'}</dd></div>
          <div><dt>Cupo</dt><dd>${activos.length} de ${c.cupo_maximo}</dd></div>
          ${can('pagos.ver') ? html`<div><dt>Inscripción</dt><dd>${money(c.costo_inscripcion)}</dd></div>
          <div><dt>Mensualidad</dt><dd>${money(c.costo_mensualidad)} × ${c.num_mensualidades}</dd></div>` : ''}
        </dl>
      </div>
      <div class="exp-btns">
        ${can('inscripciones.admin') && !['cancelado', 'terminado'].includes(c.estado) ? html`<button class="btn primary" data-insc>Inscribir alumno</button>` : ''}
        ${can('asistencia.registrar') || can('asistencia.ver') ? html`<a class="btn" href="#/asistencia?curso=${c.id}">Asistencia</a>` : ''}
        ${can('cursos.admin') ? html`<button class="btn" data-edit>Editar</button>` : ''}
        ${can('cursos.admin') && c.estado !== 'cancelado' ? html`<button class="btn danger-o" data-cancelar>Cancelar curso</button>` : ''}
        ${can('cursos.admin') && !c.alumnos.length ? html`<button class="btn danger-o" data-eliminar>Eliminar</button>` : ''}
      </div>
    </section>
    <section class="card"><h3>Alumnos inscritos <small class="muted">(${activos.length})</small></h3>
      ${tabla([
        { label: 'Matrícula', render: (a) => html`<a class="mono strong" href="#/alumno/${a.alumno_id}">${a.matricula}</a>` },
        { label: 'Alumno', key: 'nombre_completo' },
        { label: 'Teléfono', render: (a) => a.telefono || '—' },
        { label: 'Inscrito', render: (a) => fdate(a.fecha_inscripcion) },
        ...(verPagos ? [{ label: 'Pago', render: (a) => a.estado_inscripcion === 'retirada' || a.estado_alumno === 'baja' ? '' : badge('pago', a.estado_pago, { dot: true }) }] : []),
        { label: 'Estado', render: (a) => badge('insc', a.estado_inscripcion) },
        { label: '', cls: 'acc', render: (a) => can('alumnos.ver') ? html`<a class="btn sm" href="#/alumno/${a.alumno_id}">Expediente</a>` : '' },
      ], c.alumnos.map((a) => ({ ...a, _cls: a.estado_inscripcion === 'retirada' ? 'tachado' : '' })), { vacio: 'Aún no hay alumnos inscritos en este curso.' })}
    </section></div>`);
  on(root, 'click', '[data-edit]', () => formCurso(c, refrescar));
  on(root, 'click', '[data-insc]', () => abrirInscribir({ curso: c, onDone: refrescar }));
  on(root, 'click', '[data-cancelar]', async () => {
    const motivo = await pedirTexto({ titulo: 'Cancelar curso', mensaje: `¿Cancelar «${c.nombre}»? Los alumnos y pagos se conservan en el historial.`, etiqueta: 'Motivo', si: 'Cancelar curso', peligro: true });
    if (motivo === null) return;
    try { await post(`/cursos/${c.id}/cancelar`, { motivo }); toast('Curso cancelado'); refrescar(); } catch (e) { toast(e.message, 'error'); }
  });
  on(root, 'click', '[data-eliminar]', async () => {
    if (!(await confirmar({ titulo: 'Eliminar curso', mensaje: `¿Eliminar definitivamente «${c.nombre}»? Esta acción no se puede deshacer.`, si: 'Eliminar', peligro: true }))) return;
    try { await del(`/cursos/${c.id}`); toast('Curso eliminado'); location.hash = '#/cursos'; } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------- inscribir alumno a curso
/** Se usa desde el curso (curso fijo, se busca la matrícula) o desde el expediente (alumno fijo, se elige curso). */
export async function abrirInscribir({ curso, alumno, onDone }) {
  const m = modal({ titulo: 'Inscribir alumno a curso', ancho: 'md', cuerpo: spinner() });
  let cursosLista = [];
  if (!curso) {
    try {
      cursosLista = (await get('/cursos')).filter((x) => !['terminado', 'cancelado'].includes(x.estado));
    } catch (e) { m.close(); toast(e.message, 'error'); return; }
  }
  let elegido = alumno || null;
  let cursoSel = curso || null;

  setHTML(m.body, html`<form class="form">
    ${curso ? html`<div class="pago-quien"><b>${curso.nombre}</b><div class="muted">${curso.plantel || ''} · ${fdate(curso.fecha_inicio)} → ${fdate(curso.fecha_fin)}</div></div>`
      : selector('Curso', 'curso_id', cursosLista.map((x) => [x.id, `${x.nombre} (${x.codigo}) · inicia ${fdate(x.fecha_inicio)}`]), '', { requerido: true, vacio: 'Selecciona un curso…', attrs: 'data-num' })}
    ${alumno ? html`<div class="pago-quien"><b>${alumno.nombre_completo}</b><div class="muted"><span class="mono">${alumno.matricula}</span></div></div>`
      : html`<div class="field"><span>MATRÍCULA DEL ALUMNO</span>
        <input name="matricula" class="mono" autocomplete="off" placeholder="Ej. EA8067" required style="text-transform:uppercase" autofocus>
        <div class="sugerencias" data-sug hidden></div><div data-alumno class="found"></div></div>`}
    <div data-resumen class="resumen-insc"></div>
    <label class="check"><input type="checkbox" name="generar_calendario" checked> Generar calendario de pagos automáticamente</label>
    ${campo('Fecha de inscripción', 'fecha_inscripcion', hoyISO(), { tipo: 'date' })}
    <div class="form-error" hidden></div>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary lg">INSCRIBIR AL CURSO</button></div></form>`);

  const form = $('form', m.body);
  const resumen = $('[data-resumen]', form);
  const pintaResumen = () => {
    if (!cursoSel) { setHTML(resumen, ''); return; }
    const total = cursoSel.costo_inscripcion + cursoSel.costo_mensualidad * cursoSel.num_mensualidades;
    setHTML(resumen, html`<div class="alert azul">Inscripción <b>${money(cursoSel.costo_inscripcion)}</b> + ${cursoSel.num_mensualidades} mensualidad(es) de <b>${money(cursoSel.costo_mensualidad)}</b> = <b>${money(total)}</b></div>`);
  };
  pintaResumen();
  if (!curso) {
    form.curso_id.addEventListener('change', () => { cursoSel = cursosLista.find((x) => x.id === Number(form.curso_id.value)) || null; pintaResumen(); });
  }
  if (!alumno) {
    const inp = form.matricula;
    const sug = $('[data-sug]', form);
    const found = $('[data-alumno]', form);
    const buscar = debounce(async () => {
      const q = inp.value.trim();
      elegido = null;
      setHTML(found, '');
      if (q.length < 2) { sug.hidden = true; return; }
      try {
        const lista = await get('/alumnos/buscar', { q });
        const exacto = lista.find((a) => a.matricula === q.toUpperCase());
        if (exacto) { elegir(exacto); return; }
        setHTML(sug, html`${lista.map((a) => html`<button type="button" class="sug" data-id="${a.id}" data-mat="${a.matricula}" data-n="${a.nombre_completo}"><span class="mono">${a.matricula}</span><span>${a.nombre_completo}</span></button>`)}`);
        sug.hidden = !lista.length;
      } catch { sug.hidden = true; }
    }, 200);
    const elegir = (a) => {
      elegido = a;
      inp.value = a.matricula;
      sug.hidden = true;
      setHTML(found, html`<div class="alert verde">Alumno: <b>${a.nombre_completo}</b> · <span class="mono">${a.matricula}</span></div>`);
    };
    inp.addEventListener('input', buscar);
    on(sug, 'click', '.sug', (e, el) => elegir({ id: Number(el.dataset.id), matricula: el.dataset.mat, nombre_completo: el.dataset.n }));
  }
  enviarForm(form, async (d) => {
    const cid = curso ? curso.id : d.curso_id;
    if (!cid) throw new Error('Selecciona un curso');
    const body = { generar_calendario: d.generar_calendario, fecha_inscripcion: d.fecha_inscripcion || null };
    if (alumno) body.alumno_id = alumno.id; else body.matricula = (elegido ? elegido.matricula : d.matricula || '').toUpperCase();
    const r = await post(`/cursos/${cid}/inscribir`, body);
    m.close();
    toast(`${r.alumno.nombre_completo} inscrito en ${r.curso}`);
    onDone && onDone(r);
  });
}
