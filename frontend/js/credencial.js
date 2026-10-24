// Credencial del alumno (tarjeta PVC CR80 85.6 × 54 mm) con código de barras Code 128 de la matrícula.
// Pensada para impresoras de credenciales como la Zebra P110i (se imprime desde el navegador).
import { html, raw, initials, fdate, modal } from './ui.js';

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

export const ESTILO_CRED = `
  .cred{position:relative;width:85.6mm;height:54mm;overflow:hidden;background:#fff;color:#0d1730;font-family:Arial,Helvetica,sans-serif;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
  .cred *{box-sizing:border-box}
  .cred .c-top{position:absolute;left:0;top:0;right:0;height:12.5mm;background:#12203a;color:#fff;display:flex;align-items:center;gap:2.2mm;padding:0 3mm}
  .cred .c-top::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.1mm;background:#e11d2e}
  .cred .c-logo{width:9mm;height:9mm;border-radius:50%;background:#fff;object-fit:contain;padding:.5mm;flex:none}
  .cred .c-logo.ph{display:flex;align-items:center;justify-content:center;background:#e11d2e;color:#fff;font-weight:900;font-size:3.6mm}
  .cred .c-esc{font-weight:900;font-size:2.65mm;line-height:1.15;text-transform:uppercase;letter-spacing:.1mm;flex:1;min-width:0}
  .cred .c-tipo{font-size:1.9mm;letter-spacing:.35mm;color:#9fc3ff;font-weight:700;margin-top:.4mm}
  .cred .c-foto{position:absolute;left:3mm;top:15mm;width:21mm;height:26mm;border-radius:2mm;object-fit:cover;border:.5mm solid #12203a;background:#e8effc}
  .cred .c-foto.ph{display:flex;align-items:center;justify-content:center;color:#1f4eb4;font-weight:900;font-size:7mm}
  .cred .c-mat{position:absolute;left:3mm;top:42.3mm;width:21mm;text-align:center;font-family:"Courier New",monospace;font-weight:900;font-size:3.3mm;letter-spacing:.2mm}
  .cred .c-datos{position:absolute;left:27mm;right:3mm;top:14.6mm}
  .cred .c-nom{font-weight:900;font-size:3.5mm;line-height:1.12;max-height:8mm;overflow:hidden;text-transform:uppercase}
  .cred .c-l{font-size:1.75mm;letter-spacing:.25mm;color:#5b6a86;font-weight:700;text-transform:uppercase;margin-top:1.3mm}
  .cred .c-v{font-size:2.55mm;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cred .c-fila{display:flex;gap:3mm}
  .cred .c-fila > div{min-width:0}
  .cred .c-cb{position:absolute;left:27mm;right:2mm;bottom:2.2mm;height:9.5mm}
  .cred .c-cb svg{display:block;width:100%;height:100%;fill:#000}
  .cred .c-franja{position:absolute;left:0;bottom:0;width:1.6mm;top:12.5mm;background:#1f4eb4}
`;

/** a = { matricula, nombre, foto, curso, plantel, vigencia } · escuela = { nombre, logo } */
export function credencialHTML(a, escuela) {
  return html`<div class="cred">
    <div class="c-top">
      ${escuela.logo ? html`<img class="c-logo" src="${escuela.logo}" alt="">` : html`<div class="c-logo ph">${initials(escuela.nombre)}</div>`}
      <div class="c-esc">${escuela.nombre}<div class="c-tipo">CREDENCIAL DE ALUMNO</div></div>
    </div>
    <div class="c-franja"></div>
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

/** Imprime una o varias credenciales (una por hoja del tamaño de la tarjeta). */
export async function imprimirCredenciales(lista, escuela) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const tarjetas = lista.map((a) => `<div class="hoja">${credencialHTML(a, escuela)}</div>`).join('');
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
  </ol></details>`;

/** Ventana con la vista previa de una o varias credenciales y el botón de imprimir. */
export function verCredenciales(lista, escuela, { titulo = 'Credencial', extra = '' } = {}) {
  if (!document.getElementById('estilo-cred')) {
    const st = document.createElement('style');
    st.id = 'estilo-cred';
    st.textContent = ESTILO_CRED;
    document.head.appendChild(st);
  }
  const m = modal({
    titulo, ancho: lista.length > 1 ? 'lg' : 'md',
    cuerpo: html`<div class="cred-prev-lista">${lista.map((a) => html`<div class="cred-prev">${credencialHTML(a, escuela)}</div>`)}</div>
      ${raw(String(extra))}
      ${AYUDA_IMPRESION}
      <div class="modal-actions"><button type="button" class="btn" data-close>Cerrar</button>
        <button type="button" class="btn primary" data-imp-cred>🖨 Imprimir ${lista.length > 1 ? `${lista.length} credenciales` : 'credencial'}</button></div>`,
  });
  m.body.querySelector('[data-imp-cred]').addEventListener('click', () => imprimirCredenciales(lista, escuela));
  return m;
}
