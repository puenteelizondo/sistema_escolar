// Credencial del alumno (tarjeta PVC CR80 85.6 × 54 mm) con código de barras Code 128 de la matrícula.
// Pensada para impresoras de credenciales como la Zebra P110i (se imprime desde el navegador).
import { html, raw, initials, fdate, modal } from './ui.js';
import { get } from './api.js';

// Patrones Code 128 (valores 0–105) y STOP. 1 = barra, 0 = espacio; cada módulo es una unidad.
const C128 = '11011001100,11001101100,11001100110,10010011000,10010001100,10001001100,10011001000,10011000100,10001100100,11001001000,11001000100,11000100100,10110011100,10011011100,10011001110,10111001100,10011101100,10011100110,11001110010,11001011100,11001001110,11011100100,11001110100,11101101110,11101001100,11100101100,11100100110,11101100100,11100110100,11100110010,11011011000,11011000110,11000110110,10100011000,10001011000,10001000110,10110001000,10001101000,10001100010,11010001000,11000101000,11000100010,10110111000,10110001110,10001101110,10111011000,10111000110,10001110110,11101110110,11010001110,11000101110,11011101000,11011100010,11011101110,11101011000,11101000110,11100010110,11101101000,11101100010,11100011010,11101111010,11001000010,11110001010,10100110000,10100001100,10010110000,10010000110,10000101100,10000100110,10110010000,10110000100,10011010000,10011000010,10000110100,10000110010,11000010010,11001010000,11110111010,11000010100,10001111010,10100111100,10010111100,10010011110,10111100100,10011110100,10011110010,11110100100,11110010100,11110010010,11011011110,11011110110,11110110110,10101111000,10100011110,10001011110,10111101000,10111100010,11110101000,11110100010,10111011110,10111101110,11101011110,11110101110,11010000100,11010010000,11010011100'.split(',');
const STOP = '1100011101011';

/** Devuelve un <svg> con el código de barras Code 128-B del texto (letras, números y guiones). */
export function code128SVG(texto, { alto = 40, modulo = 2 } = {}) {
  const t = String(texto || '');
  const vals = [104];                                   // START B
  for (const ch of t) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 95) throw new Error('Carácter no válido para el código de barras: ' + ch);
    vals.push(v);
  }
  let suma = 104;
  vals.slice(1).forEach((v, i) => { suma += v * (i + 1); });
  vals.push(suma % 103);
  const bits = vals.map((v) => C128[v]).join('') + STOP;
  const quiet = 10;
  const ancho = (bits.length + quiet * 2) * modulo;
  let x = quiet * modulo, rects = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') {
      let j = i;
      while (bits[j] === '1') j++;
      rects += `<rect x="${x}" y="0" width="${(j - i) * modulo}" height="${alto}"/>`;
      x += (j - i) * modulo; i = j;
    } else { x += modulo; i++; }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none" class="cb">${rects}</svg>`;
}

// Capa decorativa en SVG: se imprime aunque el navegador tenga desactivados los "gráficos de fondo".
const TRAZOS = '<path d="M463 476L463 361L486 338L408 338L378 308L378 185L497 185L516 166"/><path d="M247 30L247 -66L213 -100L136 -100L104 -132L104 -224"/><path d="M85 260L-20 260L-56 224L-56 133L-26 103"/><path d="M17 0L17 46L48 77L168 77L196 105"/><path d="M340 15L340 -42L322 -60L220 -60L188 -92"/><path d="M749 134L749 45L773 21L658 21L634 -3L634 114L692 114L710 132"/><path d="M336 303L336 254L318 236L405 236"/><path d="M601 495L601 558L670 558L670 494L640 464"/><path d="M618 80L618 27L643 2L733 2L760 29"/><path d="M737 70L737 171L711 197L777 197"/><path d="M421 456L421 501L455 535L399 535L367 503"/><path d="M672 534L672 578L757 578L757 620L724 653L803 653L823 633"/><path d="M376 45L376 130L396 150L303 150L303 253L333 283"/><path d="M623 73L744 73L775 104L775 193"/><path d="M468 451L468 401L441 374L542 374L575 341L575 465L616 465L640 441"/><path d="M771 350L771 280L795 256L931 256L931 345L955 369"/>';
const NODOS = '<circle cx="516" cy="166" r="5"/><circle cx="104" cy="-224" r="5"/><circle cx="-26" cy="103" r="5"/><circle cx="196" cy="105" r="5"/><circle cx="188" cy="-92" r="5"/><circle cx="710" cy="132" r="5"/><circle cx="405" cy="236" r="5"/><circle cx="640" cy="464" r="5"/><circle cx="760" cy="29" r="5"/><circle cx="777" cy="197" r="5"/><circle cx="367" cy="503" r="5"/><circle cx="823" cy="633" r="5"/><circle cx="333" cy="283" r="5"/><circle cx="775" cy="193" r="5"/><circle cx="640" cy="441" r="5"/><circle cx="955" cy="369" r="5"/>';
function fondoSVG(reverso = false) {
  return `<svg class="c-bg" viewBox="0 0 856 540" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="cg${reverso ? 'r' : 'f'}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#173a8f"/><stop offset=".55" stop-color="#0d1f52"/><stop offset="1" stop-color="#070f2b"/></linearGradient>
      <radialGradient id="cl${reverso ? 'r' : 'f'}" cx=".15" cy=".1" r=".7"><stop offset="0" stop-color="#3b82ff" stop-opacity=".45"/><stop offset="1" stop-color="#3b82ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="cr${reverso ? 'r' : 'f'}" cx="1" cy="1" r=".6"><stop offset="0" stop-color="#e11d2e" stop-opacity=".35"/><stop offset="1" stop-color="#e11d2e" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="856" height="540" fill="url(#cg${reverso ? 'r' : 'f'})"/>
    <rect width="856" height="540" fill="url(#cl${reverso ? 'r' : 'f'})"/>
    <rect width="856" height="540" fill="url(#cr${reverso ? 'r' : 'f'})"/>
    <g fill="none" stroke="#5aa2ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="${reverso ? '.16' : '.28'}">${TRAZOS}</g>
    <g fill="#0d1f52" stroke="#7fb8ff" stroke-width="2" opacity="${reverso ? '.25' : '.45'}">${NODOS}</g>
    <path d="M640 0h70L600 118h-70z M730 0h44L664 118h-44z" fill="#e11d2e"/>
    <path d="M784 0h20L694 118h-20z" fill="#fff" opacity=".9"/>
    <rect x="0" y="524" width="856" height="16" fill="#e11d2e"/>
    <rect x="0" y="518" width="856" height="6" fill="#fff" opacity=".85"/>
    ${reverso ? '' : `
    <rect x="22" y="128" width="236" height="296" rx="22" fill="#e11d2e"/>
    <rect x="30" y="136" width="220" height="280" rx="18" fill="#fff"/>
    <rect x="30" y="436" width="220" height="56" rx="28" fill="#e11d2e"/>
    <rect x="282" y="392" width="550" height="114" rx="16" fill="#fff"/>`}
    ${reverso ? `
    <rect x="30" y="384" width="796" height="52" rx="14" fill="#e11d2e"/>
    <rect x="30" y="446" width="796" height="64" rx="14" fill="#fff"/>` : ''}
  </svg>`;
}

export const ESTILO_CRED = `
  .cred{position:relative;width:85.6mm;height:54mm;overflow:hidden;background:#0d1f52;color:#fff;font-family:Arial,Helvetica,sans-serif;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  .cred *{box-sizing:border-box}
  .cred .c-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
  .cred .c-top{position:absolute;left:3mm;top:2.4mm;right:24mm;display:flex;align-items:center;gap:2.2mm}
  .cred .c-logo{width:9.5mm;height:9.5mm;border-radius:50%;background:#fff;object-fit:contain;padding:.5mm;flex:none;border:.5mm solid #fff;box-shadow:0 0 0 .45mm #e11d2e}
  .cred .c-logo.ph{display:flex;align-items:center;justify-content:center;background:#e11d2e;color:#fff;font-weight:900;font-size:3.6mm}
  .cred .c-esc{font-weight:900;font-size:2.7mm;line-height:1.12;text-transform:uppercase;letter-spacing:.1mm;min-width:0}
  .cred .c-tipo{display:inline-block;margin-top:.6mm;font-size:1.75mm;letter-spacing:.35mm;color:#9fd0ff;font-weight:800}
  .cred .c-foto{position:absolute;left:3.4mm;top:14mm;width:21.2mm;height:27.2mm;border-radius:1.5mm;object-fit:cover;background:#dfe9fb}
  .cred .c-foto.ph{display:flex;align-items:center;justify-content:center;color:#173a8f;font-weight:900;font-size:7mm}
  .cred .c-mat{position:absolute;left:3mm;top:43.6mm;width:22mm;height:5.6mm;display:flex;align-items:center;justify-content:center;
    font-family:"Courier New",monospace;font-weight:900;font-size:3.3mm;letter-spacing:.25mm;color:#fff}
  .cred .c-datos{position:absolute;left:28.4mm;right:3mm;top:14.2mm}
  .cred .c-nom{font-weight:900;font-size:3.55mm;line-height:1.1;max-height:7.9mm;overflow:hidden;text-transform:uppercase;text-shadow:0 .3mm .8mm rgba(0,0,0,.35)}
  .cred .c-l{font-size:1.7mm;letter-spacing:.3mm;color:#9fd0ff;font-weight:800;text-transform:uppercase;margin-top:1.3mm}
  .cred .c-v{font-size:2.55mm;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cred .c-fila{display:flex;gap:4mm}
  .cred .c-fila > div{min-width:0}
  .cred .c-cb{position:absolute;left:29.6mm;right:3.8mm;top:40.4mm;height:9.2mm}
  .cred .c-cb svg{display:block;width:100%;height:100%;fill:#000}
  /* reverso */
  .cred.rev .c-top{right:26mm;top:2.6mm}
  .cred.rev .c-logo{width:7.5mm;height:7.5mm}
  .cred.rev .c-logo.ph{font-size:2.8mm}
  .cred.rev .r-cuerpo{position:absolute;left:3mm;right:3mm;top:12.6mm;bottom:16.2mm;display:flex;gap:3mm}
  .cred.rev .r-col{min-width:0;overflow:hidden}
  .cred.rev .r-contacto{flex:0 0 33mm}
  .cred.rev .r-reglas{flex:1;border-left:.3mm solid rgba(159,208,255,.45);padding-left:2.6mm}
  .cred.rev .r-t{font-size:1.65mm;letter-spacing:.35mm;color:#9fd0ff;font-weight:900;text-transform:uppercase;margin-bottom:.5mm}
  .cred.rev .r-dato{font-size:1.95mm;line-height:1.16;font-weight:700;margin-bottom:.5mm;word-break:break-word}
  .cred.rev .r-dato small{display:block;font-size:1.45mm;color:#9fd0ff;font-weight:800;letter-spacing:.15mm;text-transform:uppercase}
  .cred.rev ul{margin:0;padding:0;list-style:none}
  .cred.rev li{position:relative;padding-left:2.4mm;font-size:1.95mm;line-height:1.25;margin-bottom:.8mm}
  .cred.rev li::before{content:"";position:absolute;left:0;top:.7mm;width:1.2mm;height:1.2mm;border-radius:.2mm;transform:rotate(45deg);background:#ff4655}
  .cred.rev .r-devolver{position:absolute;left:3mm;right:3mm;top:38.4mm;height:5.2mm;display:flex;align-items:center;justify-content:center;
    padding:0 2mm;font-size:1.85mm;font-weight:800;text-align:center;line-height:1.1;color:#fff;overflow:hidden}
  .cred.rev .r-firma{position:absolute;left:5mm;right:5mm;top:44.6mm;height:6.4mm;display:flex;align-items:flex-end;gap:2mm;padding-bottom:1.2mm;
    font-size:1.6mm;color:#173a8f;font-weight:900;letter-spacing:.25mm;text-transform:uppercase}
  .cred.rev .r-firma i{flex:1;border-bottom:.25mm solid #0d1f52;height:3mm}
`;

/** a = { matricula, nombre, foto, curso, plantel, vigencia } · escuela = { nombre, logo } */
export function credencialHTML(a, escuela) {
  return html`<div class="cred">
    ${raw(fondoSVG(false))}
    <div class="c-top">
      ${escuela.logo ? html`<img class="c-logo" src="${escuela.logo}" alt="">` : html`<div class="c-logo ph">${initials(escuela.nombre)}</div>`}
      <div class="c-esc">${escuela.nombre}<br><span class="c-tipo">CREDENCIAL DE ALUMNO</span></div>
    </div>
    ${a.foto ? html`<img class="c-foto" src="${a.foto}" alt="">` : html`<div class="c-foto ph">${initials(a.nombre)}</div>`}
    <div class="c-mat">${a.matricula}</div>
    <div class="c-datos">
      <div class="c-nom">${a.nombre}</div>
      <div class="c-l">Curso</div><div class="c-v">${a.curso || '—'}</div>
      <div class="c-fila">
        <div><div class="c-l">Plantel</div><div class="c-v">${a.plantel || '—'}</div></div>
        ${a.vigencia ? html`<div><div class="c-l">Vigencia</div><div class="c-v">${fdate(a.vigencia)}</div></div>` : ''}
      </div>
    </div>
    <div class="c-cb">${raw(code128SVG(a.matricula, { alto: 40 }))}</div>
  </div>`;
}

/** Reverso igual para todos. r = datos de /credencial/reverso */
export function reversoHTML(r) {
  const reglas = String(r.credencial_reglas || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const datos = [['Dirección', r.direccion], ['Teléfono', r.telefono], ['WhatsApp', r.whatsapp], ['Correo', r.correo]].filter(([, v]) => v);
  return html`<div class="cred rev">
    ${raw(fondoSVG(true))}
    <div class="c-top">
      ${r.logo ? html`<img class="c-logo" src="${r.logo}" alt="">` : html`<div class="c-logo ph">${initials(r.escuela_nombre)}</div>`}
      <div class="c-esc">${r.escuela_nombre}</div>
    </div>
    <div class="r-cuerpo">
      <div class="r-col r-contacto"><div class="r-t">Contacto</div>
        ${datos.length ? datos.map(([k, v]) => html`<div class="r-dato"><small>${k}</small>${v}</div>`) : html`<div class="r-dato"><small>Configura la dirección y el teléfono en Configuración → Escuela</small></div>`}
      </div>
      <div class="r-col r-reglas"><div class="r-t">Reglas</div><ul>${reglas.map((x) => html`<li>${x}</li>`)}</ul></div>
    </div>
    <div class="r-devolver">${r.credencial_devolver || ''}</div>
    <div class="r-firma">Firma del alumno <i></i></div>
  </div>`;
}

/** Imprime una o varias credenciales (una por hoja del tamaño de la tarjeta). */
export function imprimirCredenciales(lista, escuela) {
  return imprimirTarjetas(lista.map((a) => credencialHTML(a, escuela)));
}

export function imprimirReversos(r, cantidad = 1) {
  const t = reversoHTML(r);
  return imprimirTarjetas(Array.from({ length: Math.max(1, cantidad) }, () => t));
}

async function imprimirTarjetas(tarjetasHTML) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const tarjetas = tarjetasHTML.map((t) => `<div class="hoja">${t}</div>`).join('');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Credenciales</title><style>
    @page{size:85.6mm 54mm;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    .hoja{width:85.6mm;height:54mm;overflow:hidden;page-break-after:always;break-after:page}
    .hoja:last-child{page-break-after:auto;break-after:auto}
    ${ESTILO_CRED}</style></head><body>${tarjetas}</body></html>`);
  doc.close();
  await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  const limpiar = () => setTimeout(() => iframe.remove(), 1500);
  iframe.contentWindow.onafterprint = limpiar;
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(limpiar, 60000); }, 120);
}

export const AYUDA_IMPRESION = html`<details class="cred-ayuda"><summary>¿Cómo imprimir en la Zebra P110i?</summary>
  <ol>
    <li>En la ventana de impresión elige la impresora <b>Zebra P110i</b>.</li>
    <li>En <b>Más opciones</b>: márgenes <b>Ninguno</b>, escala <b>100 %</b> y activa <b>Gráficos de fondo</b> (para que salgan los colores).</li>
    <li>El tamaño de papel debe ser el de tarjeta <b>CR80</b> (85.6 × 54 mm), orientación <b>horizontal</b>. Si no aparece, configúralo en las preferencias del driver de Zebra.</li>
    <li>Imprime primero una prueba en una tarjeta para revisar que nada quede recortado.</li>
    <li><b>Reverso:</b> la P110i imprime de un solo lado. Imprime los frentes, voltea las tarjetas de izquierda a derecha
      (como cuando pasas la página de un libro, para que lo de arriba siga arriba), regrésalas a la impresora e imprime los reversos. Prueba con una tarjeta primero.</li>
  </ol></details>`;

/** Ventana con la vista previa (frente y reverso) y botones para imprimir cada lado. */
export function verCredenciales(lista, escuela, { titulo = 'Credencial', extra = '' } = {}) {
  if (!document.getElementById('estilo-cred')) {
    const st = document.createElement('style');
    st.id = 'estilo-cred';
    st.textContent = ESTILO_CRED;
    document.head.appendChild(st);
  }
  const n = lista.length;
  const m = modal({
    titulo, ancho: n > 1 ? 'lg' : 'md',
    cuerpo: html`<div class="cred-lados">
        <div class="cred-lado"><div class="cred-lado-t">Frente${n > 1 ? ` (${n})` : ''}</div>
          <div class="cred-prev-lista">${lista.map((a) => html`<div class="cred-prev">${credencialHTML(a, escuela)}</div>`)}</div></div>
        <div class="cred-lado"><div class="cred-lado-t">Reverso <small class="muted">· igual para todos</small></div>
          <div class="cred-prev-lista" data-reverso><div class="cred-prev cargando-rev"></div></div></div>
      </div>
      ${raw(String(extra))}
      ${AYUDA_IMPRESION}
      <div class="modal-actions"><button type="button" class="btn" data-close>Cerrar</button>
        <button type="button" class="btn" data-imp-rev disabled>🖨 Imprimir reverso${n > 1 ? `s (${n})` : ''}</button>
        <button type="button" class="btn primary" data-imp-cred>🖨 Imprimir frente${n > 1 ? `s (${n})` : ''}</button></div>`,
  });
  m.body.querySelector('[data-imp-cred]').addEventListener('click', () => imprimirCredenciales(lista, escuela));
  get('/credencial/reverso').then((r) => {
    m.body.querySelector('[data-reverso]').innerHTML = `<div class="cred-prev">${reversoHTML(r)}</div>`;
    const b = m.body.querySelector('[data-imp-rev]');
    b.disabled = false;
    b.addEventListener('click', () => imprimirReversos(r, n));
  }).catch(() => { m.body.querySelector('[data-reverso]').innerHTML = '<span class="muted">No se pudo cargar el reverso.</span>'; });
  return m;
}
