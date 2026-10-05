import { get, post, put } from '../api.js';
import { html, raw, setHTML, $, $$, on, tabla, modal, toast, campo, selector, enviarForm, fdatetime } from '../ui.js';
import { state } from '../state.js';

export async function usuarios(root) {
  let roles, catalogo, ins;
  const cargar = async () => {
    const [lista, rr, instructores] = await Promise.all([get('/usuarios'), get('/roles'), get('/instructores')]);
    roles = rr.roles; catalogo = rr.catalogo; ins = instructores;
    setHTML(root, html`<div class="card"><div class="toolbar"><h3 class="grow">Usuarios</h3><button class="btn primary" data-nuevo>+ NUEVO USUARIO</button></div>
      ${tabla([
        { label: 'Usuario', render: (u) => html`<b class="mono">${u.username}</b>` },
        { label: 'Nombre', key: 'nombre' },
        { label: 'Rol', render: (u) => html`${u.rol}${u.instructor ? html`<small class="block muted">${u.instructor}</small>` : ''}` },
        { label: 'Último acceso', render: (u) => u.ultimo_acceso ? fdatetime(u.ultimo_acceso) : 'Nunca' },
        { label: 'Estado', render: (u) => u.activo ? html`<span class="badge b-verde">Activo</span>` : html`<span class="badge b-gris">Inactivo</span>` },
        { label: '', cls: 'acc', render: (u) => html`<button class="btn sm" data-edit="${u.id}">Editar</button><button class="btn sm" data-pass="${u.id}">Contraseña</button>` },
      ], lista)}</div>
      <div class="card"><h3>Permisos por rol</h3>
        <p class="muted">El administrador siempre tiene acceso completo. Marca lo que puede hacer cada rol; los cambios se aplican la próxima vez que cada usuario abra el sistema o recargue.</p>
        <div class="perm-grid">${roles.filter((r) => r.editable).map((r) => html`<div class="perm-col" data-rol="${r.id}">
          <h4>${r.etiqueta}</h4>
          ${Object.entries(catalogo).map(([k, l]) => html`<label class="check"><input type="checkbox" value="${k}" ${raw(r.permisos.includes(k) ? 'checked' : '')}> ${l}</label>`)}
          <button class="btn primary" data-guardar-rol="${r.id}">Guardar permisos de ${r.etiqueta}</button></div>`)}</div></div>`);
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(lista.find((u) => u.id === Number(b.dataset.edit)))));
    root.querySelectorAll('[data-pass]').forEach((b) => b.addEventListener('click', () => reset(lista.find((u) => u.id === Number(b.dataset.pass)))));
  };
  function form(u) {
    const m = modal({
      titulo: u ? `Editar usuario · ${u.username}` : 'Nuevo usuario', ancho: 'sm',
      cuerpo: html`<form class="form">
        ${campo('Nombre de usuario (para iniciar sesión)', 'username', u ? u.username : '', { requerido: true, attrs: 'maxlength="50" autocomplete="off" autofocus' })}
        ${campo('Nombre completo', 'nombre', u ? u.nombre : '', { requerido: true })}
        ${selector('Rol', 'rol_id', roles.map((r) => [r.id, r.etiqueta]), u ? u.rol_id : roles.find((r) => r.nombre === 'recepcion').id, { requerido: true, attrs: 'data-num' })}
        <div data-instr hidden>${selector('Instructor vinculado', 'instructor_id', ins.map((i) => [i.id, i.nombre]), u ? u.instructor_id : '', { vacio: '— Selecciona —', attrs: 'data-num' })}</div>
        ${u ? '' : campo('Contraseña inicial (mínimo 6)', 'password', '', { tipo: 'password', requerido: true, attrs: 'minlength="6" autocomplete="new-password"' })}
        <label class="check"><input type="checkbox" name="activo" ${raw(!u || u.activo ? 'checked' : '')}> Usuario activo</label>
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    });
    const f = $('form', m.body);
    const nombreRol = () => (roles.find((r) => r.id === Number(f.rol_id.value)) || {}).nombre;
    const sync = () => { $('[data-instr]', f).hidden = nombreRol() !== 'instructor'; };
    f.rol_id.addEventListener('change', sync); sync();
    enviarForm(f, async (d) => {
      if (nombreRol() !== 'instructor') d.instructor_id = null;
      u ? await put(`/usuarios/${u.id}`, d) : await post('/usuarios', d);
      m.close(); toast('Usuario guardado'); cargar();
    });
  }
  function reset(u) {
    const m = modal({
      titulo: `Nueva contraseña · ${u.username}`, ancho: 'sm',
      cuerpo: html`<form class="form">${campo('Contraseña nueva (mínimo 6)', 'nueva', '', { tipo: 'password', requerido: true, attrs: 'minlength="6" autocomplete="new-password" autofocus' })}
        <div class="form-error" hidden></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Cambiar contraseña</button></div></form>`,
    });
    enviarForm($('form', m.body), async (d) => { await post(`/usuarios/${u.id}/password`, { nueva: d.nueva }); m.close(); toast('Contraseña actualizada'); });
  }
  on(root, 'click', '[data-nuevo]', () => form(null));
  on(root, 'click', '[data-guardar-rol]', async (e, el) => {
    const col = el.closest('[data-rol]');
    const permisos = $$('input:checked', col).map((i) => i.value);
    try { await put(`/roles/${col.dataset.rol}`, { permisos }); toast('Permisos guardados'); } catch (er) { toast(er.message, 'error'); }
  });
  await cargar();
}
