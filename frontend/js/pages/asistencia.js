import { get, post, url } from '../api.js';
import { html, raw, setHTML, $, $$, on, fdate, badge, tabla, toast, selector, hoyISO, spinner, initials, descargar } from '../ui.js';
import { can, state } from '../state.js';

const DIA_JS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const LARGO = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const fechaLarga = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = LARGO.format(new Date(y, m - 1, d));
  return iso === hoyISO() ? `Hoy · ${t}` : t;
};
const BOTONES = [['asistencia', 'Asistió'], ['falta', 'Faltó'], ['retardo', 'Retardo'], ['justificada', 'Justificada']];

export async function asistencia(root, ctx) {
  const cursos = (await get('/cursos')).filter((c) => !['cancelado', 'terminado'].includes(c.estado));
  const esInstructor = state.me && state.me.rol === 'instructor';
  let tab = ctx.params.get('mat') ? 'alumno' : 'curso';
  const edita = can('asistencia.registrar');
  setHTML(root, html`<div class="card asis-card">
    ${esInstructor ? '' : html`<div class="tabs"><button class="tab" data-tab="curso">Pasar lista por curso</button><button class="tab" data-tab="alumno">Consultar por matrícula</button></div>`}
    <div id="cuerpo"></div></div>`);
  const cuerpo = $('#cuerpo', root);
  const pintarTabs = () => $$('.tab', root).forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
  let fechaSel = hoyISO();

  // ------------------------------------------------ por curso
  function vistaCurso() {
    const id = ctx.params.get('curso') || (cursos.length === 1 ? String(cursos[0].id) : '');
    if (id) { listaCurso(id); return; }
    elegirCurso();
  }

  function elegirCurso() {
    const hoyL = DIA_JS[new Date().getDay()];
    const deHoy = cursos.filter((c) => (c.dias_clase || '').split(',').includes(hoyL));
    const otros = cursos.filter((c) => !deHoy.includes(c));
    const tarjeta = (c, hoy) => html`<a class="curso-big ${hoy ? 'hoy' : ''}" href="#/asistencia?curso=${c.id}">
      <span class="cb-t">${c.nombre}</span>
      <span class="cb-s">${c.horario || ''} ${c.plantel ? `· ${c.plantel}` : ''}</span>
      <span class="cb-go">${hoy ? 'Clase de hoy · ' : ''}Pasar lista →</span></a>`;
    setHTML(cuerpo, html`
      <div class="asis-titulo-fila"><h3 class="asis-titulo">¿Qué clase vas a calificar?</h3>
        ${cursos.length ? html`<button class="btn" data-excel="">📥 Descargar Excel de ${esInstructor ? 'mis cursos' : 'todos los cursos'}</button>` : ''}</div>
      ${!cursos.length ? html`<div class="empty">No tienes cursos asignados.</div>` : ''}
      ${deHoy.length ? html`<div class="cb-grupo">Clases de hoy</div><div class="cb-grid">${deHoy.map((c) => tarjeta(c, true))}</div>` : ''}
      ${otros.length ? html`<div class="cb-grupo">${deHoy.length ? 'Otros cursos' : 'Tus cursos'}</div><div class="cb-grid">${otros.map((c) => tarjeta(c, false))}</div>` : ''}`);
  }

  async function listaCurso(cursoId) {
    setHTML(cuerpo, spinner());
    try {
      const r = await get(`/asistencia/curso/${cursoId}`, { fecha: fechaSel });
      pintarLista(r, cursoId);
    } catch (e) { setHTML(cuerpo, html`<div class="alert rojo">${e.message}</div>`); }
  }

  function pintarLista(r, cursoId) {
    const volver = cursos.length > 1 || !esInstructor ? html`<a class="btn sm" href="#/asistencia">← Cambiar de curso</a>` : '';
    if (!r.alumnos.length) {
      setHTML(cuerpo, html`<div class="asis-top">${volver}</div><div class="empty">Este curso no tiene alumnos inscritos.</div>`);
      return;
    }
    setHTML(cuerpo, html`
      <div class="asis-top">${volver}</div>
      <div class="pl-head">
        <div><h3 class="pl-curso">${r.curso.nombre}</h3>
          <div class="pl-fecha">${fechaLarga(r.fecha)} ${r.curso.horario ? html`<span class="muted">· ${r.curso.horario}</span>` : ''}</div></div>
        <div class="pl-acc"><button class="btn sm" data-excel="${cursoId}">📥 Descargar Excel</button>
          <label class="pl-cambiar">Cambiar día <input type="date" name="fecha" value="${r.fecha}" max="${hoyISO()}"></label></div>
      </div>
      ${r.guardada ? html`<div class="alert verde">Esta lista ya estaba guardada. Puedes corregir lo que haga falta y volver a guardar.</div>`
        : html`<p class="pl-ayuda">Todos aparecen con <b>Asistió</b>. Solo toca el botón de quien faltó o llegó tarde.</p>`}
      <div class="pl-cuenta" id="cuenta"></div>
      ${edita ? html`<div class="pl-todos"><button class="btn" data-todos>Todos asistieron</button></div>` : ''}
      <div class="pl-lista" id="pl-lista" data-curso="${cursoId}" data-fecha="${r.fecha}">
        ${r.alumnos.map((a) => html`<div class="pl-fila" data-insc="${a.inscripcion_id}">
          <div class="pl-av">${initials(a.nombre_completo)}</div>
          <div class="pl-quien"><b>${a.nombre_completo}</b><small class="mono muted">${a.matricula}${a.stats.porcentaje === null ? '' : ` · ${a.stats.porcentaje}% asistencia`}</small></div>
          ${edita ? html`<div class="pl-btns">${BOTONES.map(([v, t]) => html`<label class="pl-b s-${v}"><input type="radio" name="e${a.inscripcion_id}" value="${v}" ${raw((a.estado || 'asistencia') === v ? 'checked' : '')}><span>${t}</span></label>`)}</div>`
            : (a.estado ? badge('asis', a.estado) : html`<span class="muted">Sin registro</span>`)}
        </div>`)}
      </div>
      ${edita ? html`<div class="pl-barra"><button class="btn primary xl" data-guardar>GUARDAR LISTA</button></div>` : ''}`);
    contar();
  }

  function contar() {
    const lista = $('#pl-lista', cuerpo);
    if (!lista) return;
    const n = { asistencia: 0, falta: 0, retardo: 0, justificada: 0 };
    $$('input:checked', lista).forEach((i) => { n[i.value] += 1; });
    const el = $('#cuenta', cuerpo);
    if (el) setHTML(el, html`<span class="pc s-asistencia"><b>${n.asistencia}</b> asistieron</span>
      <span class="pc s-falta"><b>${n.falta}</b> faltaron</span>
      <span class="pc s-retardo"><b>${n.retardo}</b> retardos</span>
      ${n.justificada ? html`<span class="pc s-justificada"><b>${n.justificada}</b> justificadas</span>` : ''}`);
    $$('.pl-fila', lista).forEach((f) => {
      const v = f.querySelector('input:checked');
      f.dataset.estado = v ? v.value : '';
    });
  }

  async function guardar() {
    const lista = $('#pl-lista', cuerpo);
    const registros = $$('.pl-fila[data-insc]', lista).map((g) => ({
      inscripcion_id: Number(g.dataset.insc), estado: g.querySelector('input:checked').value,
    }));
    const btn = $('[data-guardar]', cuerpo);
    btn.disabled = true;
    try {
      const cursoId = lista.dataset.curso;
      const fecha = lista.dataset.fecha;
      const r = await post(`/asistencia/curso/${cursoId}`, { fecha, registros });
      const n = { asistencia: 0, falta: 0, retardo: 0, justificada: 0 };
      registros.forEach((x) => { n[x.estado] += 1; });
      toast(`Lista guardada (${r.registrados} alumnos)`);
      setHTML(cuerpo, html`<div class="pl-ok"><div class="pl-ok-i">✓</div><h2>Lista guardada</h2>
        <p>${fechaLarga(fecha)}</p>
        <p><b>${n.asistencia}</b> asistieron · <b>${n.falta}</b> faltaron · <b>${n.retardo}</b> retardos${n.justificada ? html` · <b>${n.justificada}</b> justificadas` : ''}</p>
        <div class="pl-ok-btns"><a class="btn primary xl" href="#/asistencia">Listo</a>
          <button class="btn" data-corregir="${cursoId}">Corregir esta lista</button></div></div>`);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }

  // ------------------------------------------------ por matrícula
  function vistaAlumno() {
    setHTML(cuerpo, html`<form class="toolbar" data-bm><input class="grow mono" name="mat" placeholder="Matrícula, ej. EA8067" value="${ctx.params.get('mat') || ''}" autofocus style="text-transform:uppercase">
      <button class="btn primary">Consultar</button></form><div id="res"></div>`);
    if (ctx.params.get('mat')) consultar(ctx.params.get('mat'));
  }
  async function consultar(mat) {
    const res = $('#res', cuerpo);
    setHTML(res, spinner());
    try {
      const r = await get(`/asistencia/alumno/${encodeURIComponent(mat.trim().toUpperCase())}`);
      setHTML(res, html`<h3><span class="mono">${r.alumno.matricula}</span> · ${r.alumno.nombre_completo}</h3>
        ${r.cursos.length ? r.cursos.map((c) => html`<div class="insc"><div class="insc-head"><b class="insc-t">${c.curso}</b></div>
          <div class="asis-line">Asistencias: <b>${c.asistencias}</b> · Faltas: <b>${c.faltas}</b> · Retardos: <b>${c.retardos}</b> · Justificadas: <b>${c.justificadas}</b>
            · Porcentaje: <b>${c.porcentaje === null ? '—' : c.porcentaje + '%'}</b></div>
          <div class="chips-hist">${c.registros.slice(0, 40).map((x) => html`<span class="hist s-${x.estado}" title="${x.estado}">${fdate(x.fecha).slice(0, 5)}<b>${({ asistencia: '✓', falta: 'F', retardo: 'R', justificada: 'J' })[x.estado]}</b></span>`)}</div></div>`)
          : html`<div class="empty">Este alumno no tiene asistencias registradas.</div>`}`);
    } catch (e) { setHTML(res, html`<div class="alert amarillo">${e.message}</div>`); }
  }

  const abrir = () => { pintarTabs(); tab === 'alumno' ? vistaAlumno() : vistaCurso(); };
  on(root, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; abrir(); });
  on(root, 'click', '[data-excel]', (e, el) => descargar(url('/asistencia/exportar', { curso_id: el.dataset.excel })));
  on(root, 'click', '[data-guardar]', guardar);
  on(root, 'click', '[data-corregir]', (e, el) => listaCurso(el.dataset.corregir));
  on(root, 'click', '[data-todos]', () => { $$('.pl-b input[value=asistencia]', root).forEach((i) => { i.checked = true; }); contar(); });
  on(root, 'change', '.pl-b input', contar);
  on(root, 'change', '[name=fecha]', (e, el) => {
    if (!el.value) return;
    fechaSel = el.value;
    listaCurso($('#pl-lista', cuerpo).dataset.curso);
  });
  root.addEventListener('submit', (e) => {
    if (e.target.matches('[data-bm]')) { e.preventDefault(); consultar(e.target.mat.value); }
  });
  abrir();
}
