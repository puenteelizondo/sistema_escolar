import { get, post, put, del } from '../api.js';
import { html, raw, setHTML, $, on, fdate, modal, toast, campo, selector, areaTexto, enviarForm, confirmar, hoyISO } from '../ui.js';
import { can } from '../state.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const TIPOS = {
  inicio: ['verde', 'Inicio de curso'], fin: ['rojo', 'Terminación de curso'], pago: ['amarillo', 'Fechas de pago'],
  examen: ['morado', 'Examen'], evento: ['azul', 'Evento'], clase: ['gris', 'Días de clase'],
};

export async function calendario(root, ctx) {
  const hoy = new Date();
  let y = hoy.getFullYear();
  let m = hoy.getMonth(); // 0..11
  let sel = hoyISO();
  let items = [];
  const admin = can('eventos.admin');

  setHTML(root, html`<div class="card cal">
    <div class="cal-bar">
      <button class="btn" data-prev>‹</button><h2 id="cal-t"></h2><button class="btn" data-next>›</button>
      <button class="btn" data-hoy>Hoy</button>
      <span class="grow"></span>
      ${admin ? html`<button class="btn primary" data-nuevo>+ Evento / examen</button>` : ''}
    </div>
    <div class="leyenda">${Object.entries(TIPOS).map(([k, [c, l]]) => html`<span class="ley"><i class="pt c-${c}"></i>${l}</span>`)}</div>
    <div class="cal-wrap"><div class="cal-grid" id="grid"></div><aside class="cal-dia" id="dia"></aside></div></div>`);

  async function cargar() {
    const mes = `${y}-${String(m + 1).padStart(2, '0')}`;
    const r = await get('/calendario', { mes });
    items = r.items;
    pintar();
  }

  function pintar() {
    $('#cal-t', root).textContent = `${MESES[m]} ${y}`;
    const primero = new Date(y, m, 1);
    const offset = (primero.getDay() + 6) % 7; // lunes primero
    const dias = new Date(y, m + 1, 0).getDate();
    const porDia = {};
    items.forEach((i) => { (porDia[i.fecha] ||= []).push(i); });
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push(html`<div class="cal-c vacio"></div>`);
    for (let d = 1; d <= dias; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const lista = porDia[iso] || [];
      const tipos = [...new Set(lista.map((x) => x.tipo))];
      const destacados = lista.filter((x) => x.tipo !== 'clase');
      celdas.push(html`<button class="cal-c ${iso === hoyISO() ? 'hoy' : ''} ${iso === sel ? 'sel' : ''}" data-dia="${iso}">
        <span class="n">${d}</span>
        <span class="ev">${destacados.slice(0, 2).map((x) => html`<span class="ev-i c-${TIPOS[x.tipo][0]}">${x.titulo}</span>`)}${destacados.length > 2 ? html`<span class="mas">+${destacados.length - 2} más</span>` : ''}</span>
        <span class="pts">${tipos.map((t) => html`<i class="pt c-${TIPOS[t][0]}"></i>`)}</span></button>`);
    }
    setHTML($('#grid', root), html`${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => html`<div class="cal-h">${d}</div>`)}${celdas}`);
    pintarDia(porDia[sel] || []);
  }

  function pintarDia(lista) {
    setHTML($('#dia', root), html`<h3>${fdate(sel)}</h3>
      ${lista.length ? html`<ul class="lista">${lista.map((x) => html`<li class="cal-item">
        <i class="pt c-${TIPOS[x.tipo][0]}"></i>
        <div><b>${x.link ? html`<a href="${x.link}">${x.titulo}</a>` : (x.curso_id && x.tipo !== 'evento' && x.tipo !== 'examen' && can('cursos.ver') ? html`<a href="#/curso/${x.curso_id}">${x.titulo}</a>` : x.titulo)}</b>
          <small class="block muted">${TIPOS[x.tipo][1]}${x.detalle ? ` · ${x.detalle}` : ''}</small></div>
        ${admin && x.evento_id ? html`<span class="row-btns"><button class="btn sm" data-edit="${x.evento_id}">✎</button><button class="btn sm danger-o" data-del="${x.evento_id}">✕</button></span>` : ''}</li>`)}</ul>`
        : html`<div class="empty sm">Sin actividades este día.</div>`}
      ${admin ? html`<button class="btn block" data-nuevo>+ Agregar evento este día</button>` : ''}`);
  }

  async function formEvento(ev) {
    let cursos = [];
    try { cursos = await get('/cursos'); } catch { /* opcional */ }
    const mod = modal({
      titulo: ev ? 'Editar evento' : 'Nuevo evento', ancho: 'sm',
      cuerpo: html`<form class="form">
        ${campo('Título', 'titulo', ev ? ev.titulo : '', { requerido: true, attrs: 'maxlength="150" autofocus' })}
        ${selector('Tipo', 'tipo', [['examen', 'Examen'], ['evento', 'Evento']], ev ? ev.tipo : 'examen', { requerido: true })}
        ${campo('Fecha', 'fecha', ev ? ev.fecha : sel, { tipo: 'date', requerido: true })}
        ${selector('Curso (opcional)', 'curso_id', cursos.map((c) => [c.id, `${c.nombre} (${c.codigo})`]), ev ? ev.curso_id : '', { vacio: '— Para todos —', attrs: 'data-num' })}
        ${campo('Descripción', 'descripcion', ev ? ev.descripcion : '', { attrs: 'maxlength="255"' })}
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    });
    enviarForm($('form', mod.body), async (d) => {
      ev ? await put(`/eventos/${ev.id}`, d) : await post('/eventos', d);
      mod.close();
      toast('Evento guardado');
      await cargar();
    });
  }

  on(root, 'click', '[data-prev]', () => { m--; if (m < 0) { m = 11; y--; } cargar(); });
  on(root, 'click', '[data-next]', () => { m++; if (m > 11) { m = 0; y++; } cargar(); });
  on(root, 'click', '[data-hoy]', () => { y = hoy.getFullYear(); m = hoy.getMonth(); sel = hoyISO(); cargar(); });
  on(root, 'click', '[data-dia]', (e, el) => { sel = el.dataset.dia; pintar(); });
  on(root, 'click', '[data-nuevo]', () => formEvento(null));
  on(root, 'click', '[data-edit]', async (e, el) => {
    const evs = await get('/eventos');
    const ev = evs.find((x) => x.id === Number(el.dataset.edit));
    if (ev) formEvento(ev);
  });
  on(root, 'click', '[data-del]', async (e, el) => {
    if (!(await confirmar({ titulo: 'Eliminar evento', mensaje: '¿Eliminar este evento del calendario?', si: 'Eliminar', peligro: true }))) return;
    try { await del(`/eventos/${el.dataset.del}`); toast('Evento eliminado'); cargar(); } catch (er) { toast(er.message, 'error'); }
  });
  await cargar();
}
