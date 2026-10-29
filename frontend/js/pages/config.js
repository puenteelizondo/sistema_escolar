import { get, put, post, url } from '../api.js';
import { isAdmin } from '../state.js';
import {
  html, raw, setHTML, $, $$, on, debounce, toast, campo, selector, areaTexto, tabla, fdatetime, spinner,
  imagenADataURL, hoyISO, modal, descargar, fdate,
} from '../ui.js';
import { can } from '../state.js';
import { ticketPreview } from '../ticket.js';

const fmtBytes = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export async function configuracion(root, ctx) {
  const tabs = [];
  if (can('config.admin')) tabs.push(['escuela', 'Escuela'], ['ticket', 'Ticket'], ['sistema', 'Matrícula y cobro']);
  if (can('respaldos.admin')) tabs.push(['respaldos', 'Respaldos']);
  if (can('bitacora.ver')) tabs.push(['actividad', 'Registro de actividades']);
  let tab = ctx.params.get('tab') || tabs[0][0];
  let cfg = null;
  let ultimoTicket = 0;
  if (can('config.admin')) {
    const r = await get('/config');
    cfg = r.config;
    ultimoTicket = r.ultimo_ticket;
  }

  setHTML(root, html`<div class="card"><div class="tabs">${tabs.map(([k, l]) => html`<button class="tab" data-tab="${k}">${l}</button>`)}</div><div id="cuerpo"></div></div>`);
  const cuerpo = $('#cuerpo', root);
  const pintarTabs = () => $$('.tab', root).forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));

  async function guardar(datos, extra) {
    try {
      const r = await put('/config', datos);
      Object.assign(cfg, datos);
      toast(r.cambios.length ? 'Configuración guardada' : 'Sin cambios');
      extra && extra();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------------------------ escuela
  function vistaEscuela() {
    setHTML(cuerpo, html`<form class="form cfg" data-f="escuela">
      <div class="form-grid">
        ${campo('Nombre de la escuela', 'escuela_nombre', cfg.escuela_nombre, { requerido: true, clase: 'span2' })}
        ${campo('Dirección', 'direccion', cfg.direccion, { clase: 'span2' })}
        ${campo('Teléfono', 'telefono', cfg.telefono, { tipo: 'tel' })}
        ${campo('WhatsApp', 'whatsapp', cfg.whatsapp, { tipo: 'tel' })}
        ${campo('Correo', 'correo', cfg.correo, { tipo: 'email' })}
        ${areaTexto('Datos fiscales (RFC, razón social…)', 'datos_fiscales', cfg.datos_fiscales, { clase: 'span2', filas: 3 })}
        <div class="span2 cfg-sub">Credencial <small class="muted">(dirección, teléfono, WhatsApp y logo se toman de arriba)</small></div>
        ${campo('Encabezado del frente', 'credencial_encabezado_frente', cfg.credencial_encabezado_frente, { clase: 'span2', attrs: 'maxlength="70"' })}
        ${campo('Encabezado del reverso', 'credencial_encabezado_reverso', cfg.credencial_encabezado_reverso, { clase: 'span2', attrs: 'maxlength="70"' })}
        ${campo('CCT (clave del centro de trabajo)', 'cct', cfg.cct, { attrs: 'maxlength="20"' })}
        ${areaTexto('Reglamento (una regla por renglón, máximo 4)', 'credencial_reglas', cfg.credencial_reglas, { clase: 'span2', filas: 4 })}
      </div>
      <div class="logo-box"><div class="logo-prev" data-logo-prev>${cfg.logo ? html`<img src="${cfg.logo}" alt="Logo">` : html`<span class="muted">Sin logo</span>`}</div>
        <div><label class="btn">Subir logo (PNG o JPG)<input type="file" accept="image/png,image/jpeg" hidden data-logo></label>
          <button type="button" class="btn danger-o" data-quitar-logo>Quitar logo</button>
          <p class="muted">Se muestra en el menú, el inicio de sesión y el ticket.</p></div></div>
      <div class="modal-actions"><button class="btn primary lg">GUARDAR</button></div></form>`);
    const f = $('form', cuerpo);
    let logo = cfg.logo;
    $('[data-logo]', f).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        logo = await imagenADataURL(file, 420, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png');
        setHTML($('[data-logo-prev]', f), html`<img src="${logo}" alt="Logo">`);
      } catch (er) { toast(er.message, 'error'); }
    });
    on(f, 'click', '[data-quitar-logo]', () => { logo = ''; setHTML($('[data-logo-prev]', f), html`<span class="muted">Sin logo</span>`); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(['escuela_nombre', 'direccion', 'telefono', 'whatsapp', 'correo', 'datos_fiscales', 'credencial_reglas', 'credencial_encabezado_frente', 'credencial_encabezado_reverso', 'cct'].map((k) => [k, f[k].value.trim()]));
      guardar({ ...d, logo }, () => toast('Recarga la página para ver el nuevo nombre/logo en el menú', 'info', 5000));
    });
  }

  // ------------------------------------------------ ticket
  function vistaTicket() {
    setHTML(cuerpo, html`<div class="cfg-ticket"><form class="form cfg" data-f="ticket">
      ${campo('Título del ticket', 'ticket_titulo', cfg.ticket_titulo, { requerido: true, attrs: 'maxlength="60"', ayuda: 'Ej. CONTROL DE PAGO 2026' })}
      ${campo('Texto al pie', 'ticket_pie', cfg.ticket_pie, { attrs: 'maxlength="120"' })}
      ${selector('Tamaño de impresión', 'ticket_ancho', [['58', 'Impresora térmica 58 mm'], ['80', 'Impresora térmica 80 mm'], ['carta', 'Impresora normal (hoja carta)']], cfg.ticket_ancho)}
      <label class="check"><input type="checkbox" name="ticket_mostrar_logo" ${raw(cfg.ticket_mostrar_logo === 'true' ? 'checked' : '')}> Mostrar logo</label>
      <label class="check"><input type="checkbox" name="ticket_mostrar_concepto" ${raw(cfg.ticket_mostrar_concepto === 'true' ? 'checked' : '')}> Mostrar concepto (Inscripción / Mensualidad)</label>
      <hr>
      ${campo('Número del siguiente ticket', 'ticket_siguiente', Number(cfg.ticket_siguiente), { tipo: 'number', requerido: true, attrs: 'min="1"',
        ayuda: ultimoTicket ? `Último ticket emitido: ${String(ultimoTicket).padStart(4, '0')}. Solo puedes subir el contador, nunca repetir números.` : 'Aún no se emite ningún ticket. Puedes empezar en el número que quieras (p. ej. 38).' })}
      <div class="modal-actions"><button class="btn primary lg">GUARDAR TICKET</button></div></form>
      <div><h4>Vista previa</h4><div id="muestra"></div></div></div>`);
    const f = $('form', cuerpo);
    const muestra = () => {
      const num = String(Number(f.ticket_siguiente.value || 1)).padStart(4, '0');
      setHTML($('#muestra', cuerpo), ticketPreview({
        id: 0, numero_texto: num, fecha: hoyISO(), plantel: 'Plantel 1', matricula: 'EA8067', importe: 1000,
        curso: 'Mecánica Automotriz', concepto: 'Mensualidad 1', alumno: 'Juan Pérez',
        formato: {
          escuela: cfg.escuela_nombre, titulo: f.ticket_titulo.value, pie: f.ticket_pie.value, ancho: f.ticket_ancho.value,
          logo: f.ticket_mostrar_logo.checked ? cfg.logo : '', mostrar_concepto: f.ticket_mostrar_concepto.checked,
        },
      }));
    };
    f.addEventListener('input', muestra);
    f.addEventListener('change', muestra);
    muestra();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guardar({
        ticket_titulo: f.ticket_titulo.value.trim(), ticket_pie: f.ticket_pie.value.trim(), ticket_ancho: f.ticket_ancho.value,
        ticket_mostrar_logo: f.ticket_mostrar_logo.checked, ticket_mostrar_concepto: f.ticket_mostrar_concepto.checked,
        ticket_siguiente: Number(f.ticket_siguiente.value),
      });
    });
  }

  // ------------------------------------------------ sistema
  function vistaSistema() {
    const metodos = (() => { try { return JSON.parse(cfg.metodos_pago).join(', '); } catch { return cfg.metodos_pago; } })();
    setHTML(cuerpo, html`<form class="form cfg" data-f="sistema"><div class="form-grid">
      ${campo('Prefijo de matrícula', 'matricula_prefijo', cfg.matricula_prefijo, { attrs: 'maxlength="6" style="text-transform:uppercase"', ayuda: 'Ej. EA → EA8067' })}
      ${campo('Siguiente número de matrícula', 'matricula_siguiente', Number(cfg.matricula_siguiente), { tipo: 'number', attrs: 'min="1"', ayuda: 'Se usa al crear alumnos sin escribir matrícula.' })}
      ${campo('Métodos de pago (separados por coma)', 'metodos_pago', metodos, { requerido: true, clase: 'span2', ayuda: 'El primero será el método por defecto en el cobro.' })}
      ${campo('Días de aviso de próximo vencimiento', 'dias_aviso', Number(cfg.dias_aviso), { tipo: 'number', attrs: 'min="0" max="60"', ayuda: 'Un pago se marca amarillo cuando faltan estos días o menos.' })}
      </div><div class="modal-actions"><button class="btn primary lg">GUARDAR</button></div></form>`);
    const f = $('form', cuerpo);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      guardar({
        matricula_prefijo: f.matricula_prefijo.value.trim(), matricula_siguiente: Number(f.matricula_siguiente.value),
        metodos_pago: f.metodos_pago.value, dias_aviso: Number(f.dias_aviso.value),
      });
    });
  }

  // ------------------------------------------------ respaldos
  async function vistaRespaldos() {
    setHTML(cuerpo, spinner());
    const r = await get('/respaldos');
    setHTML(cuerpo, html`${isAdmin() ? html`<div class="resp-grid">
        <section class="resp-card">
          <div class="resp-ico">⬇️</div>
          <h3>Descargar respaldo completo</h3>
          <p class="muted">Un solo archivo con <b>toda</b> la información: alumnos y fotos, cursos, pagos, tickets, asistencia, usuarios y configuración.
            Guárdalo fuera del servidor (USB, Google Drive, correo). Si algún día se pierde el servidor, con este archivo se recupera todo.</p>
          <div class="resp-ult">Último respaldo: <b>${r.ultimo ? fdatetime(r.ultimo) : 'nunca'}</b></div>
          <button class="btn primary lg block" data-descargar>DESCARGAR RESPALDO</button>
        </section>
        <section class="resp-card resp-peligro">
          <div class="resp-ico">⬆️</div>
          <h3>Restaurar desde un respaldo</h3>
          <p class="muted">Carga un archivo de respaldo. <b>Toda la información actual se reemplaza</b> por la del archivo.
            Al terminar la página se reinicia y se vuelve a iniciar sesión.</p>
          <label class="resp-file"><input type="file" accept=".gz,.json,application/gzip,application/json" data-archivo>
            <span data-archivo-nombre>Elegir archivo de respaldo…</span></label>
          <div class="resp-info" data-info hidden></div>
          <button class="btn danger lg block" data-restaurar disabled>RESTAURAR INFORMACIÓN</button>
        </section>
      </div>
      <p class="muted resp-nota">Recomendación: descarga un respaldo cada semana y antes de cualquier cambio importante. Solo el administrador ve esta sección.</p>` : ''}
      <details class="resp-servidor" ${raw(isAdmin() ? '' : 'open')}><summary>Copias guardadas en el servidor (${r.items.length})</summary>
        <div class="resp-top"><span class="muted">Copias internas del servidor. En Render no se conservan; usa "Descargar respaldo".</span>
          <button class="btn" data-crear>Crear copia en el servidor</button></div>
        ${tabla([
          { label: 'Archivo', render: (x) => html`<span class="mono">${x.nombre}</span>` },
          { label: 'Fecha', render: (x) => fdatetime(x.fecha) },
          { label: 'Tamaño', cls: 'num', render: (x) => fmtBytes(x.tamano) },
          { label: '', cls: 'acc', render: (x) => html`<a class="btn sm" href="${url('/respaldos/' + x.nombre)}">Descargar</a>` },
        ], r.items, { vacio: 'No hay copias en el servidor.' })}
      </details>`);
    if (isAdmin()) prepararRestaurar();
  }
  on(root, 'click', '[data-crear]', async (e, el) => {
    el.disabled = true;
    try { const r = await post('/respaldos'); toast(`Copia creada (${fmtBytes(r.tamano)})`); await vistaRespaldos(); } catch (er) { toast(er.message, 'error'); el.disabled = false; }
  });
  on(root, 'click', '[data-descargar]', (e, el) => {
    descargar(url('/respaldos/archivo'));
    toast('Generando respaldo… se descargará en unos segundos');
    el.disabled = true;
    setTimeout(() => { vistaRespaldos(); }, 4000);
  });

  function prepararRestaurar() {
    let archivo = null;
    const inp = $('[data-archivo]', cuerpo), info = $('[data-info]', cuerpo), btn = $('[data-restaurar]', cuerpo);
    inp.addEventListener('change', async () => {
      archivo = inp.files[0] || null;
      btn.disabled = true;
      $('[data-archivo-nombre]', cuerpo).textContent = archivo ? `${archivo.name} · ${fmtBytes(archivo.size)}` : 'Elegir archivo de respaldo…';
      if (!archivo) { info.hidden = true; return; }
      info.hidden = false;
      setHTML(info, html`<span class="muted">Revisando el archivo…</span>`);
      try {
        const d = await leerResumen(archivo);
        const n = d.conteos || {};
        setHTML(info, html`<b>Respaldo válido</b> · del ${fdatetime(d.fecha)}${d.escuela ? html` · ${d.escuela}` : ''}<br>
          ${n.alumnos || 0} alumnos · ${n.cursos || 0} cursos · ${n.pagos || 0} pagos · ${n.usuarios || 0} usuarios`);
        info.classList.remove('err');
        btn.disabled = false;
      } catch (er) {
        info.classList.add('err');
        setHTML(info, html`<b>No se puede usar:</b> ${er.message}`);
      }
    });
    btn.addEventListener('click', async () => {
      if (!archivo || !(await confirmarRestaurar())) return;
      const espera = modal({ titulo: '', cerrable: false, ancho: 'sm',
        cuerpo: html`<div class="resp-espera"><div class="spin"></div><b>Restaurando la información…</b><span class="muted">No cierres ni recargues esta página.</span></div>` });
      try {
        const fd = new FormData();
        fd.append('archivo', archivo, archivo.name);
        const res = await fetch('/api/respaldos/restaurar', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
        setHTML(espera.body, html`<div class="resp-espera ok"><div class="resp-ico">✅</div><b>Información restaurada</b>
          <span>${data.alumnos} alumnos · ${data.cursos} cursos · ${data.pagos} pagos</span>
          <span class="muted">La página se reiniciará para que vuelvas a iniciar sesión…</span></div>`);
        setTimeout(async () => {
          try { await post('/auth/logout'); } catch { /* la sesión puede no existir ya */ }
          location.hash = '';
          location.reload();
        }, 3000);
      } catch (er) {
        espera.close();
        toast(er.message, 'error');
      }
    });
  }
  // ------------------------------------------------ actividad
  async function vistaActividad() {
    const f = { q: '', accion: '', usuario: '', desde: '', hasta: '' };
    const r0 = await get('/bitacora', { limit: 1 });
    setHTML(cuerpo, html`<div class="toolbar">
      <input class="grow" type="search" name="q" placeholder="Buscar en el detalle…">
      ${selector('', 'accion', r0.acciones.map((a) => [a, a.replaceAll('_', ' ')]), '', { vacio: 'Todas las acciones', clase: 'inline' })}
      <input name="usuario" placeholder="Usuario" style="max-width:140px">
      <label class="inline-f">Desde <input type="date" name="desde"></label><label class="inline-f">hasta <input type="date" name="hasta"></label>
    </div><div id="bit"></div>`);
    const cargar = async () => {
      const r = await get('/bitacora', f);
      setHTML($('#bit', cuerpo), html`${tabla([
        { label: 'Fecha y hora', render: (l) => fdatetime(l.fecha) },
        { label: 'Usuario', render: (l) => html`<span class="mono">${l.usuario || '—'}</span>` },
        { label: 'Acción', render: (l) => l.accion.replaceAll('_', ' ') },
        { label: 'Detalle', key: 'detalle' },
      ], r.items)}<p class="muted">${r.items.length} de ${r.total} registro(s)</p>`);
    };
    const recargar = debounce(() => cargar().catch((e) => toast(e.message, 'error')), 300);
    cuerpo.addEventListener('input', (e) => { if (e.target.name in f) { f[e.target.name] = e.target.value; recargar(); } });
    await cargar();
  }

  const abrir = async () => {
    pintarTabs();
    try {
      await ({ escuela: vistaEscuela, ticket: vistaTicket, sistema: vistaSistema, respaldos: vistaRespaldos, actividad: vistaActividad })[tab]();
    } catch (e) { toast(e.message, 'error'); }
  };
  on(root, 'click', '[data-tab]', (e, el) => { tab = el.dataset.tab; abrir(); });
  abrir();
}

/** Lee el encabezado del respaldo en el navegador (sin subirlo) para mostrar qué contiene. */
async function leerResumen(file) {
  let texto;
  try {
    const cab = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (cab[0] === 0x1f && cab[1] === 0x8b) {
      if (!('DecompressionStream' in window)) return { fecha: null, conteos: {} };
      texto = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      texto = await file.text();
    }
  } catch { throw new Error('el archivo está dañado o incompleto'); }
  let d;
  try { d = JSON.parse(texto); } catch { throw new Error('no es un respaldo del sistema'); }
  if (!d || d.formato !== 'sistema-escolar-respaldo' || !d.tablas) throw new Error('no es un respaldo del sistema');
  return { fecha: d.fecha, escuela: d.escuela, conteos: d.conteos || {} };
}

function confirmarRestaurar() {
  return new Promise((resolve) => {
    let listo = false;
    const fin = (v) => { if (!listo) { listo = true; resolve(v); } };
    const m = modal({
      titulo: '¿Reemplazar toda la información?', ancho: 'sm', onClose: () => fin(false),
      cuerpo: html`<form class="form">
        <p>Se borrará <b>todo</b> lo que hay ahora (alumnos, pagos, asistencia, usuarios…) y se cargará lo del respaldo.
          Lo que se haya registrado después de ese respaldo se perderá.</p>
        <p class="muted">Si no estás seguro, primero descarga un respaldo de lo que hay ahora.</p>
        <label class="field"><span>Escribe RESTAURAR para confirmar</span><input name="t" autocomplete="off" autofocus></label>
        <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button>
          <button class="btn danger" disabled>Sí, restaurar</button></div></form>`,
    });
    const f = m.body.querySelector('form'), b = f.querySelector('button.danger');
    f.t.addEventListener('input', () => { b.disabled = f.t.value.trim().toUpperCase() !== 'RESTAURAR'; });
    f.addEventListener('submit', (e) => { e.preventDefault(); if (!b.disabled) { fin(true); m.close(); } });
  });
}
