import { get, put, post, url } from '../api.js';
import {
  html, raw, setHTML, $, $$, on, debounce, toast, campo, selector, areaTexto, tabla, fdatetime, spinner,
  imagenADataURL, hoyISO,
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
      const d = Object.fromEntries(['escuela_nombre', 'direccion', 'telefono', 'whatsapp', 'correo', 'datos_fiscales'].map((k) => [k, f[k].value.trim()]));
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
    setHTML(cuerpo, html`<div class="resp-top">
      <div><b>Último respaldo:</b> ${r.ultimo ? fdatetime(r.ultimo) : 'todavía no se ha hecho ninguno'}</div>
      <button class="btn primary lg" data-crear>CREAR RESPALDO AHORA</button></div>
      ${tabla([
        { label: 'Archivo', render: (x) => html`<span class="mono">${x.nombre}</span>` },
        { label: 'Fecha', render: (x) => fdatetime(x.fecha) },
        { label: 'Tamaño', cls: 'num', render: (x) => fmtBytes(x.tamano) },
        { label: '', cls: 'acc', render: (x) => html`<a class="btn sm" href="${url('/respaldos/' + x.nombre)}">Descargar</a>` },
      ], r.items, { vacio: 'No hay respaldos todavía.' })}
      <p class="muted">Los respaldos se guardan en el servidor (volumen «backups» de Docker). Descarga una copia y guárdala fuera de esta computadora (USB, nube).
        Para restaurar consulta el archivo README.</p>`);
  }
  on(root, 'click', '[data-crear]', async (e, el) => {
    el.disabled = true;
    try { const r = await post('/respaldos'); toast(`Respaldo creado (${fmtBytes(r.tamano)})`); await vistaRespaldos(); } catch (er) { toast(er.message, 'error'); el.disabled = false; }
  });

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
