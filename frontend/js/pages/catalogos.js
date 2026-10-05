import { get, post, put } from '../api.js';
import { html, raw, setHTML, $, on, tabla, modal, toast, campo, enviarForm, badge } from '../ui.js';
import { invalidar } from '../catalog.js';

const activoBadge = (a) => (a ? html`<span class="badge b-verde">Activo</span>` : html`<span class="badge b-gris">Inactivo</span>`);
const checkActivo = (v) => html`<label class="check"><input type="checkbox" name="activo" ${raw(v ? 'checked' : '')}> Activo (disponible para nuevos cursos y alumnos)</label>`;

// ---------------------------------------------------------------- planteles
export async function planteles(root) {
  const cargar = async () => {
    const lista = await get('/planteles');
    setHTML(root, html`<div class="card"><div class="toolbar"><h3 class="grow">Planteles</h3><button class="btn primary" data-nuevo>+ NUEVO PLANTEL</button></div>
      ${tabla([
        { label: 'Nombre', render: (p) => html`<b>${p.nombre}</b>` },
        { label: 'Dirección', render: (p) => p.direccion || '—' },
        { label: 'Teléfono', render: (p) => p.telefono || '—' },
        { label: 'Responsable', render: (p) => p.responsable || '—' },
        { label: 'Cursos', cls: 'num', key: 'cursos' },
        { label: 'Estado', render: (p) => activoBadge(p.activo) },
        { label: '', cls: 'acc', render: (p) => html`<button class="btn sm" data-edit="${p.id}">Editar</button>` },
      ], lista, { vacio: 'Aún no hay planteles. Crea el primero.' })}</div>`);
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(lista.find((p) => p.id === Number(b.dataset.edit)))));
  };
  function form(p) {
    const m = modal({
      titulo: p ? 'Editar plantel' : 'Nuevo plantel', ancho: 'sm',
      cuerpo: html`<form class="form">
        ${campo('Nombre', 'nombre', p ? p.nombre : '', { requerido: true, attrs: 'maxlength="120" autofocus' })}
        ${campo('Dirección', 'direccion', p ? p.direccion : '')}
        ${campo('Teléfono', 'telefono', p ? p.telefono : '', { tipo: 'tel' })}
        ${campo('Responsable', 'responsable', p ? p.responsable : '')}
        ${checkActivo(p ? p.activo : true)}
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    });
    enviarForm($('form', m.body), async (d) => {
      p ? await put(`/planteles/${p.id}`, d) : await post('/planteles', d);
      invalidar(); m.close(); toast('Plantel guardado'); cargar();
    });
  }
  on(root, 'click', '[data-nuevo]', () => form(null));
  await cargar();
}

// ---------------------------------------------------------------- instructores
export async function instructores(root) {
  const cargar = async () => {
    const lista = await get('/instructores');
    setHTML(root, html`<div class="card"><div class="toolbar"><h3 class="grow">Instructores</h3><button class="btn primary" data-nuevo>+ NUEVO INSTRUCTOR</button></div>
      ${tabla([
        { label: 'Nombre', render: (i) => html`<b>${i.nombre}</b>` },
        { label: 'Especialidad', render: (i) => i.especialidad || '—' },
        { label: 'Teléfono', render: (i) => i.telefono || '—' },
        { label: 'WhatsApp', render: (i) => i.whatsapp || '—' },
        { label: 'Correo', render: (i) => i.correo || '—' },
        { label: 'Cursos', cls: 'num', key: 'cursos' },
        { label: 'Estado', render: (i) => activoBadge(i.activo) },
        { label: '', cls: 'acc', render: (i) => html`<button class="btn sm" data-edit="${i.id}">Editar</button>` },
      ], lista, { vacio: 'Aún no hay instructores. Crea el primero.' })}</div>`);
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(lista.find((p) => p.id === Number(b.dataset.edit)))));
  };
  function form(i) {
    const m = modal({
      titulo: i ? 'Editar instructor' : 'Nuevo instructor', ancho: 'sm',
      cuerpo: html`<form class="form">
        ${campo('Nombre completo', 'nombre', i ? i.nombre : '', { requerido: true, attrs: 'maxlength="120" autofocus' })}
        ${campo('Especialidad', 'especialidad', i ? i.especialidad : '')}
        ${campo('Teléfono', 'telefono', i ? i.telefono : '', { tipo: 'tel' })}
        ${campo('WhatsApp', 'whatsapp', i ? i.whatsapp : '', { tipo: 'tel' })}
        ${campo('Correo', 'correo', i ? i.correo : '', { tipo: 'email' })}
        ${checkActivo(i ? i.activo : true)}
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    });
    enviarForm($('form', m.body), async (d) => {
      i ? await put(`/instructores/${i.id}`, d) : await post('/instructores', d);
      invalidar(); m.close(); toast('Instructor guardado'); cargar();
    });
  }
  on(root, 'click', '[data-nuevo]', () => form(null));
  await cargar();
}
