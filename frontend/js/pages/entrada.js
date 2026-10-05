// Pantalla de bienvenida con lector de credenciales: el lector "teclea" la matrícula y envía ENTER.
import { post } from '../api.js';
import { html, raw, setHTML, $, $$, initials } from '../ui.js';
import { state } from '../state.js';

const HORA = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const FECHA = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

const ESTILO = {
  ok: { clase: 'ok', icono: '✓', seg: 4 },
  retardo: { clase: 'retardo', icono: '⏰', seg: 5 },
  ya_registrada: { clase: 'ya', icono: '✓', seg: 4 },
  sin_clase: { clase: 'err', icono: '!', seg: 6 },
  baja: { clase: 'err', icono: '!', seg: 6 },
  no_encontrado: { clase: 'err', icono: '?', seg: 4 },
};

function pitido(tipo) {
  try {
    const ctx = pitido.ctx || (pitido.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const notas = tipo === 'ok' ? [[880, 0, 0.12]] : tipo === 'retardo' ? [[660, 0, 0.12], [660, 0.18, 0.12]] : [[220, 0, 0.35]];
    notas.forEach(([f, t, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + d);
    });
  } catch { /* sin audio */ }
}

export async function entrada(root, ctx) {
  const publica = ctx.publica || {};
  let tReset = null;
  let tReloj = null;
  let ocupado = false;
  let pendiente = null; // { codigo, opciones } mientras el alumno elige curso

  setHTML(root, html`<div class="kiosko-pant">
    <div class="k-top">
      <div class="k-marca">${publica.logo ? html`<img src="${publica.logo}" alt="">` : ''}<span>${publica.escuela_nombre || ''}</span></div>
      <div class="k-reloj"><b id="k-hora"></b><span id="k-fecha"></span></div>
    </div>
    <div class="k-centro" id="k-centro"></div>
    <input id="k-input" class="k-input" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Lector de credenciales">
    <button class="k-salir" data-k-salir>${state.me && state.me.rol === 'entrada' ? 'Cerrar sesión' : '← Salir'}</button>
  </div>`);
  document.body.classList.add('kiosko');
  const input = $('#k-input', root);
  const centro = $('#k-centro', root);

  const reloj = () => {
    const d = new Date();
    $('#k-hora', root).textContent = HORA.format(d);
    $('#k-fecha', root).textContent = FECHA.format(d);
  };
  reloj();
  tReloj = setInterval(reloj, 15000);

  function inicio() {
    pendiente = null;
    setHTML(centro, html`<div class="k-espera">
      <div class="k-tarjeta" aria-hidden="true"><span></span></div>
      <h1>¡Bienvenido!</h1>
      <p>Acerca tu credencial al lector</p></div>`);
    enfocar();
  }

  const enfocar = () => { if (document.body.contains(input)) input.focus({ preventScroll: true }); };

  function mostrar(r) {
    clearTimeout(tReset);
    const st = ESTILO[r.resultado] || ESTILO.sin_clase;
    pitido(st.clase === 'ok' || st.clase === 'ya' ? 'ok' : st.clase === 'retardo' ? 'retardo' : 'err');
    const a = r.alumno;
    setHTML(centro, html`<div class="k-res ${st.clase}">
      ${a ? (a.foto ? html`<img class="k-foto" src="${a.foto}" alt="">` : html`<div class="k-foto k-ini">${initials(a.nombre)}</div>`)
        : html`<div class="k-icono">${st.icono}</div>`}
      <div class="k-estado">${a ? html`<span class="k-i">${st.icono}</span>` : ''} ${r.mensaje}</div>
      ${a ? html`<div class="k-nombre">${a.nombre}</div><div class="k-mat">${a.matricula}</div>` : ''}
      ${r.curso ? html`<div class="k-curso">${r.curso.nombre}${r.curso.horario ? html` <span>· ${r.curso.horario}</span>` : ''}</div>` : ''}
      ${r.detalle ? html`<div class="k-det">Hoy: ${r.detalle}</div>` : ''}
      ${r.hora && r.curso ? html`<div class="k-hora-r">Entrada a las ${r.hora}</div>` : ''}
    </div>`);
    tReset = setTimeout(inicio, st.seg * 1000);
  }

  function elegir(r, codigo) {
    clearTimeout(tReset);
    pendiente = { codigo, opciones: r.opciones };
    pitido('ok');
    const a = r.alumno;
    setHTML(centro, html`<div class="k-res elegir">
      ${a.foto ? html`<img class="k-foto" src="${a.foto}" alt="">` : html`<div class="k-foto k-ini">${initials(a.nombre)}</div>`}
      <div class="k-nombre">${a.nombre}</div>
      <div class="k-estado">${r.mensaje}</div>
      <div class="k-opciones">${r.opciones.map((o, i) => html`<button class="k-op" data-curso="${o.curso_id}"><b>${i + 1}</b><span>${o.nombre}<small>${o.horario || ''}</small></span></button>`)}</div>
      <div class="k-det">Toca tu clase o presiona el número</div></div>`);
    tReset = setTimeout(inicio, 20000);
  }

  async function enviar(codigo, cursoId) {
    if (ocupado) return;
    ocupado = true;
    try {
      const r = await post('/entrada/escaneo', cursoId ? { codigo, curso_id: cursoId } : { codigo });
      if (r.resultado === 'elegir') elegir(r, codigo); else { pendiente = null; mostrar(r); }
    } catch (e) {
      mostrar({ resultado: 'sin_clase', mensaje: e.status === 0 ? 'Sin conexión con el sistema. Avisa en recepción.' : e.message });
    } finally { ocupado = false; enfocar(); }
  }

  function tecla(e) {
    if (pendiente && /^[1-9]$/.test(e.key)) {
      const o = pendiente.opciones[Number(e.key) - 1];
      if (o) { e.preventDefault(); enviar(pendiente.codigo, o.curso_id); return; }
    }
    if (e.target === input && e.key === 'Enter') {
      e.preventDefault();
      const codigo = input.value.trim();
      input.value = '';
      if (codigo) enviar(codigo);
    }
  }
  document.addEventListener('keydown', tecla);
  const refocus = (e) => { if (!e.target.closest('button')) enfocar(); };
  document.addEventListener('click', refocus);
  input.addEventListener('blur', () => setTimeout(enfocar, 50));
  root.addEventListener('click', (e) => {
    const op = e.target.closest('[data-curso]');
    if (op && pendiente) enviar(pendiente.codigo, Number(op.dataset.curso));
    if (e.target.closest('[data-k-salir]')) {
      if (state.me && state.me.rol === 'entrada') document.querySelector('[data-salir]').click();
      else location.hash = '#/inicio';
    }
  });

  inicio();
  return () => {
    clearTimeout(tReset);
    clearInterval(tReloj);
    document.removeEventListener('keydown', tecla);
    document.removeEventListener('click', refocus);
    document.body.classList.remove('kiosko');
  };
}
