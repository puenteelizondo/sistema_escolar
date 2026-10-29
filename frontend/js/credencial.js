// Credencial del alumno como imagen PNG lista para la Zebra P110i.
// Medida 8.38 × 5.26 cm a 300 ppp (990 × 621 px): la impresora no tiene que escalar la imagen.
// Diseño claro (fondo blanco): los fondos oscuros a todo color manchan y rayan la cinta de la P110i.
// Sin código de barras: las tarjetas ya traen su identificador (se registra al dar de alta al alumno).
import { html, raw, fdate, modal, toast, initials } from './ui.js';
import { get } from './api.js';

const ANCHO_MM = 83.8;
const ALTO_MM = 52.6;
const PPP = 300;
const PX = PPP / 25.4;                      // píxeles por milímetro
export const ANCHO_PX = Math.round(ANCHO_MM * PX);  // 990
export const ALTO_PX = Math.round(ALTO_MM * PX);    // 621

const TINTA = '#1f2430';
const GRIS = '#4a5060';
const AZUL = '#1f4fd1';
const ROJO = '#e0451f';
const FUENTE = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

// ---------------------------------------------------------------- utilidades de dibujo (en milímetros)
const cargarImagen = (src) => new Promise((res) => {
  if (!src) { res(null); return; }
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

function fuente(ctx, mm, peso = 400) { ctx.font = `${peso} ${mm}px ${FUENTE}`; }

/** Escribe un texto en una línea; si no cabe, reduce la letra hasta que quepa. */
function texto(ctx, t, x, y, { mm = 2, peso = 400, color = TINTA, max = 0, alinear = 'left' } = {}) {
  let tam = mm;
  fuente(ctx, tam, peso);
  if (max) while (ctx.measureText(t).width > max && tam > mm * 0.6) { tam -= 0.05; fuente(ctx, tam, peso); }
  ctx.fillStyle = color;
  ctx.textAlign = alinear;
  ctx.fillText(t, x, y);
  ctx.textAlign = 'left';
  return ctx.measureText(t).width;
}

/** Parte un texto en renglones que quepan en `max` mm (con "…" si sobra). */
function renglones(ctx, t, max, maxLineas, mm, peso) {
  fuente(ctx, mm, peso);
  const palabras = String(t || '').split(/\s+/).filter(Boolean);
  const out = [];
  let linea = '';
  for (const p of palabras) {
    const prueba = linea ? `${linea} ${p}` : p;
    if (ctx.measureText(prueba).width <= max || !linea) linea = prueba;
    else { out.push(linea); linea = p; }
  }
  if (linea) out.push(linea);
  if (out.length > maxLineas) {
    const corte = out.slice(0, maxLineas);
    let ult = corte[maxLineas - 1];
    while (ult.length > 1 && ctx.measureText(`${ult}…`).width > max) ult = ult.slice(0, -1);
    corte[maxLineas - 1] = `${ult}…`;
    return corte;
  }
  return out;
}

function parrafo(ctx, t, x, y, { mm = 1.8, peso = 400, color = TINTA, max = 40, lineas = 3, alto = 2.3 } = {}) {
  const rs = renglones(ctx, t, max, lineas, mm, peso);
  ctx.fillStyle = color;
  rs.forEach((r, i) => ctx.fillText(r, x, y + i * alto));
  return rs.length;
}

/** "ETIQUETA: valor" con la etiqueta en negritas. */
function campoLinea(ctx, etiqueta, valor, x, y, { mm = 2.1, max = 46 } = {}) {
  fuente(ctx, mm, 700);
  ctx.fillStyle = TINTA;
  ctx.fillText(etiqueta, x, y);
  const w = ctx.measureText(etiqueta).width;
  texto(ctx, valor, x + w + 0.6, y, { mm, peso: 500, color: '#2e3442', max: Math.max(5, max - w - 0.6) });
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function imagenCubre(ctx, img, x, y, w, h) {
  const esc = Math.max(w / img.width, h / img.height);
  const sw = w / esc, sh = h / esc;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function imagenContiene(ctx, img, x, y, w, h) {
  const esc = Math.min(w / img.width, h / img.height);
  const dw = img.width * esc, dh = img.height * esc;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Franja de bandera a cuadros (3 columnas) en el borde. */
function cuadros(ctx, x, w) {
  const c = w / 3;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, 0, w, ALTO_MM);
  ctx.fillStyle = '#111';
  for (let f = 0; f * c < ALTO_MM; f++) {
    for (let k = 0; k < 3; k++) if ((f + k) % 2 === 0) ctx.fillRect(x + k * c, f * c, c + 0.02, c + 0.02);
  }
}

function iconoRFID(ctx, x, y) {
  ctx.strokeStyle = TINTA;
  ctx.lineWidth = 0.55;
  ctx.lineCap = 'round';
  [1.6, 3.0, 4.4].forEach((r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 3.2, Math.PI / 3.2);
    ctx.stroke();
  });
  texto(ctx, 'RFID', x + 1.4, y + 7.4, { mm: 1.9, peso: 700, alinear: 'center' });
}

function lienzo() {
  const cv = document.createElement('canvas');
  cv.width = ANCHO_PX;
  cv.height = ALTO_PX;
  const ctx = cv.getContext('2d');
  ctx.scale(cv.width / ANCHO_MM, cv.height / ALTO_MM);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ANCHO_MM, ALTO_MM);
  ctx.textBaseline = 'alphabetic';
  return { cv, ctx };
}

// ---------------------------------------------------------------- frente
async function dibujarFrente(a, e) {
  const { cv, ctx } = lienzo();
  const [foto, logo] = await Promise.all([cargarImagen(a.foto), cargarImagen(e.logo)]);
  const borde = 77.6; // donde empieza la franja a cuadros

  cuadros(ctx, borde, ANCHO_MM - borde);
  texto(ctx, e.encabezado_frente || e.escuela_nombre || '', 4, 5.9, { mm: 2.55, peso: 700, color: '#2b2f3a', max: borde - 6 });
  ctx.fillStyle = AZUL;
  ctx.fillRect(4, 7.5, borde - 4, 0.6);

  // foto con marco
  redondeado(ctx, 4, 10, 20.6, 24.6, 1.6);
  ctx.fillStyle = '#eef1f6';
  ctx.fill();
  ctx.save();
  redondeado(ctx, 4.7, 10.7, 19.2, 23.2, 1.1);
  ctx.clip();
  if (foto) imagenCubre(ctx, foto, 4.7, 10.7, 19.2, 23.2);
  else texto(ctx, initials(a.nombre), 14.3, 25, { mm: 7, peso: 700, color: '#9aa4b8', alinear: 'center' });
  ctx.restore();
  redondeado(ctx, 4, 10, 20.6, 24.6, 1.6);
  ctx.strokeStyle = TINTA;
  ctx.lineWidth = 0.45;
  ctx.stroke();

  if (logo) imagenContiene(ctx, logo, 3.4, 36.2, 22, 13);

  // datos
  const x = 28.4, max = borde - x - 2;
  let y = 12.4;
  texto(ctx, 'DATOS DEL ESTUDIANTE', x, y, { mm: 2.15, peso: 700, color: '#2b2f3a', max });
  y += 2.9;
  texto(ctx, 'NOMBRE COMPLETO:', x, y, { mm: 1.6, peso: 400, color: GRIS });
  y += 3.1;
  const nl = parrafo(ctx, String(a.nombre || '').toUpperCase(), x, y, { mm: 2.5, peso: 700, max, lineas: 2, alto: 2.9 });
  y += (nl - 1) * 2.9 + 3.9;
  campoLinea(ctx, 'MATRÍCULA: ', a.matricula || '', x, y, { mm: 2.3, max });
  y += 2.7;
  texto(ctx, 'CARRERA:', x, y, { mm: 1.6, peso: 400, color: GRIS });
  y += 2.8;
  const cl = parrafo(ctx, String(a.curso || '—').toUpperCase(), x, y, { mm: 2.05, peso: 700, max: 35, lineas: 2, alto: 2.55 });
  iconoRFID(ctx, 69.4, y - 2.4 + (cl - 1) * 1.2);
  y += (cl - 1) * 2.55 + 3.1;
  const filas = [
    ['GRADO: ', a.grado],
    ['TIPO DE SANGRE: ', a.tipo_sangre],
    ['VIGENCIA: ', a.vigencia ? (a.vigencia_inicio ? `${fdate(a.vigencia_inicio)} - ${fdate(a.vigencia)}` : fdate(a.vigencia)) : ''],
    ['CCT: ', e.cct],
  ].filter(([, v]) => v);
  for (const [k, v] of filas) {
    if (y > 49.6) break;
    campoLinea(ctx, k, v, x, y, { mm: 2.05, max });
    y += 2.75;
  }

  ctx.fillStyle = ROJO;
  ctx.fillRect(0, ALTO_MM - 1.9, borde, 1.9);
  return cv;
}

// ---------------------------------------------------------------- reverso
async function dibujarReverso(a, e) {
  const { cv, ctx } = lienzo();
  const logo = await cargarImagen(e.logo);
  const borde = 6.2; // franja a cuadros a la izquierda
  const x = borde + 2.8, fin = ANCHO_MM - 3;

  cuadros(ctx, 0, borde);
  texto(ctx, e.encabezado_reverso || e.escuela_nombre || '', x, 5.9, { mm: 2.4, peso: 700, color: '#2b2f3a', max: fin - x });
  ctx.fillStyle = AZUL;
  ctx.fillRect(x, 7.5, fin - x, 0.6);

  // reglamento
  let y = 11.4;
  const nt = parrafo(ctx, 'REGLAMENTOS Y TÉRMINOS DEL ESTUDIANTE', x, y, { mm: 2.0, peso: 700, color: '#2b2f3a', max: 40, lineas: 2, alto: 2.5 });
  y += (nt - 1) * 2.5 + 3.0;
  const reglas = String(e.credencial_reglas || '').split(/\n+/).map((r) => r.trim()).filter(Boolean).slice(0, 4);
  // que quepan todas las reglas: si no, se usa una letra un poco más chica
  const limite = 31.2, ancho = 37.2;
  let tam = 1.75;
  const altoDe = (mm) => reglas.reduce((s, r) => s + renglones(ctx, r, ancho, 2, mm, 400).length * mm * 1.24 + 0.15, 0);
  while (tam > 1.45 && y + altoDe(tam) - tam * 1.24 > limite) tam -= 0.05;
  reglas.forEach((r, i) => {
    texto(ctx, `${i + 1}.`, x + 1.4, y, { mm: tam, color: '#2e3442' });
    const n = parrafo(ctx, r, x + 4.0, y, { mm: tam, color: '#2e3442', max: ancho, lineas: 2, alto: tam * 1.24 });
    y += n * tam * 1.24 + 0.15;
  });

  if (logo) imagenContiene(ctx, logo, 51.6, 10.4, 28.4, 17.5);

  // contacto de la escuela
  y = Math.max(y + 1.6, 33.2);
  texto(ctx, 'INFORMACIÓN DE CONTACTO', x, y, { mm: 2.0, peso: 700, color: '#2b2f3a', max: 38 });
  y += 2.9;
  const contacto = [['Dirección: ', e.direccion], ['Whatsapp: ', e.whatsapp], ['Tel: ', e.telefono]].filter(([, v]) => v);
  for (const [k, v] of contacto) {
    if (y > 49.2) break;
    const n = parrafo(ctx, `${k}${v}`, x + 0.8, y, { mm: 1.75, color: '#2e3442', max: 37.5, lineas: 3, alto: 2.2 });
    y += n * 2.2 + 0.1;
  }

  // contacto de emergencia del alumno
  const bx = 49.4, by = 31.4, bw = fin - bx, bh = 16.6;
  redondeado(ctx, bx, by, bw, bh, 1.2);
  ctx.strokeStyle = '#c8754f';
  ctx.lineWidth = 0.3;
  ctx.stroke();
  let ey = by + 3.0;
  texto(ctx, 'CONTACTO DE EMERGENCIA', bx + 1.4, ey, { mm: 1.95, peso: 700, max: bw - 2.8 });
  ey += 2.8;
  const n = parrafo(ctx, `Nombre: ${(a.contacto_emergencia || '—').toUpperCase()}`, bx + 1.4, ey, { mm: 1.8, color: '#2e3442', max: bw - 2.8, lineas: 2, alto: 2.3 });
  ey += n * 2.3 + 0.2;
  texto(ctx, `Parentesco: ${(a.parentesco_emergencia || '—').toUpperCase()}`, bx + 1.4, ey, { mm: 1.8, color: '#2e3442', max: bw - 2.8 });
  ey += 2.5;
  texto(ctx, `Teléfono: ${a.telefono_emergencia || '—'}`, bx + 1.4, ey, { mm: 1.8, color: '#2e3442', max: bw - 2.8 });

  ctx.fillStyle = ROJO;
  ctx.fillRect(borde, ALTO_MM - 1.9, ANCHO_MM - borde, 1.9);
  return cv;
}

// ---------------------------------------------------------------- PNG con 300 ppp, ZIP y descarga
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, inicio = 0, fin = bytes.length) {
  let c = 0xffffffff;
  for (let i = inicio; i < fin; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG del lienzo con la resolución (300 ppp) escrita en el archivo, para que se imprima a 8.38 × 5.26 cm. */
async function pngConPPP(cv) {
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const png = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(PPP / 0.0254); // píxeles por metro
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unidad: metro
  dv.setUint32(17, crc32(chunk, 4, 17));
  const finIHDR = 8 + 25; // firma (8) + IHDR (4+4+13+4)
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, finIHDR), 0);
  out.set(chunk, finIHDR);
  out.set(png.subarray(finIHDR), finIHDR + chunk.length);
  return out;
}

/** ZIP sin compresión (los PNG ya vienen comprimidos). */
function zip(archivos) {
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  for (const f of archivos) {
    const nombre = enc.encode(f.nombre);
    const crc = crc32(f.datos);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, f.datos.length, true); loc.setUint32(22, f.datos.length, true);
    loc.setUint16(26, nombre.length, true);
    partes.push(new Uint8Array(loc.buffer), nombre, f.datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, f.datos.length, true); cen.setUint32(24, f.datos.length, true);
    cen.setUint16(28, nombre.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nombre);
    offset += 30 + nombre.length + f.datos.length;
  }
  const tam = central.reduce((s, p) => s + p.length, 0);
  const finc = new DataView(new ArrayBuffer(22));
  finc.setUint32(0, 0x06054b50, true); finc.setUint16(8, archivos.length, true); finc.setUint16(10, archivos.length, true);
  finc.setUint32(12, tam, true); finc.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(finc.buffer)], { type: 'application/zip' });
}

function descargarBlob(blob, nombre) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

/** Imprime imágenes (una por hoja del tamaño de la tarjeta) desde el navegador. */
async function imprimirImagenes(urls) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Credenciales</title><style>
    @page{size:${ANCHO_MM}mm ${ALTO_MM}mm;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    img{display:block;width:${ANCHO_MM}mm;height:${ALTO_MM}mm;page-break-after:always;break-after:page}
    img:last-child{page-break-after:auto;break-after:auto}
  </style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`);
  doc.close();
  await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  const limpiar = () => setTimeout(() => iframe.remove(), 1500);
  iframe.contentWindow.onafterprint = limpiar;
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(limpiar, 60000); }, 150);
}

const nombreArchivo = (a, lado) => `credencial-${String(a.matricula || 'alumno').replace(/[^A-Za-z0-9_-]/g, '')}-${lado}.png`;

// ---------------------------------------------------------------- ventana de vista previa
export const AYUDA_IMPRESION = html`<details class="cred-ayuda"><summary>¿Cómo imprimir en la Zebra P110i?</summary>
  <ol>
    <li>Usa <b>Descargar PNG</b>: la imagen sale a <b>8.38 × 5.26 cm a 300 ppp</b> (990 × 621 px), la resolución de la P110i.</li>
    <li>Ábrela con el programa de la Zebra o con <b>Fotos / Imprimir</b> de Windows, elige la <b>Zebra P110i</b>,
      tamaño de tarjeta <b>CR80</b>, orientación <b>horizontal</b> y <b>"Ajustar a la página"</b> desactivado o en tamaño real.</li>
    <li>El diseño es claro a propósito: los fondos oscuros a todo color son los que manchan y rayan la tarjeta en esta impresora.</li>
    <li>Si sale con manchas o rayas: limpia el cabezal y el rodillo con la tarjeta de limpieza de Zebra, revisa que la cinta no esté arrugada
      y toma las tarjetas solo por los bordes.</li>
    <li><b>Reverso:</b> imprime el frente, voltea la tarjeta de izquierda a derecha (como pasar una página) y vuelve a meterla.</li>
  </ol></details>`;

/** lista: [{ matricula, nombre, foto, curso, plantel, vigencia_inicio, vigencia, grado, tipo_sangre,
 *           contacto_emergencia, parentesco_emergencia, telefono_emergencia }] */
export async function verCredenciales(lista, { titulo = 'Credencial', extra = '' } = {}) {
  const n = lista.length;
  const m = modal({
    titulo, ancho: n > 1 ? 'lg' : 'md',
    cuerpo: html`<div class="cred-gen"><div class="spin"></div><span class="muted">Generando credencial${n > 1 ? 'es' : ''}…</span></div>`,
  });
  let e;
  try {
    const r = await get('/credencial/reverso');
    e = { ...r, encabezado_frente: r.credencial_encabezado_frente, encabezado_reverso: r.credencial_encabezado_reverso };
  } catch (er) { m.close(); toast(er.message, 'error'); return null; }

  const tarjetas = [];
  for (const a of lista) {
    const [f, r] = await Promise.all([dibujarFrente(a, e), dibujarReverso(a, e)]);
    tarjetas.push({ a, frente: f, reverso: r, uf: f.toDataURL('image/png'), ur: r.toDataURL('image/png') });
  }
  const unica = n === 1;
  m.body.innerHTML = String(html`
    ${unica ? html`<div class="cred-lados">
        <div><div class="cred-lado-t">Frente</div><img class="cred-img" src="${tarjetas[0].uf}" alt="Frente"></div>
        <div><div class="cred-lado-t">Reverso</div><img class="cred-img" src="${tarjetas[0].ur}" alt="Reverso"></div>
      </div>` : html`<div class="cred-lote">${tarjetas.map((t) => html`<div class="cred-par">
        <img class="cred-img" src="${t.uf}" alt=""><img class="cred-img" src="${t.ur}" alt=""></div>`)}</div>`}
    <p class="cred-medida">PNG de <b>8.38 × 5.26 cm</b> · 300 ppp · ${ANCHO_PX} × ${ALTO_PX} px</p>
    ${raw(String(extra))}
    ${AYUDA_IMPRESION}
    <div class="modal-actions cred-acciones">
      <button type="button" class="btn" data-close>Cerrar</button>
      ${unica ? html`
        <button type="button" class="btn" data-imp="reverso">🖨 Imprimir reverso</button>
        <button type="button" class="btn" data-imp="frente">🖨 Imprimir frente</button>
        <button type="button" class="btn" data-png="reverso">⬇ Reverso PNG</button>
        <button type="button" class="btn primary" data-png="frente">⬇ Frente PNG</button>` : html`
        <button type="button" class="btn" data-imp="reverso">🖨 Imprimir reversos (${n})</button>
        <button type="button" class="btn" data-imp="frente">🖨 Imprimir frentes (${n})</button>
        <button type="button" class="btn primary" data-zip>⬇ Descargar todas (ZIP)</button>`}
    </div>`);

  m.body.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', async () => {
    const t = tarjetas[0], lado = b.dataset.png;
    descargarBlob(new Blob([await pngConPPP(lado === 'frente' ? t.frente : t.reverso)], { type: 'image/png' }), nombreArchivo(t.a, lado));
  }));
  m.body.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', () => {
    imprimirImagenes(tarjetas.map((t) => (b.dataset.imp === 'frente' ? t.uf : t.ur)));
  }));
  const bz = m.body.querySelector('[data-zip]');
  if (bz) bz.addEventListener('click', async () => {
    bz.disabled = true;
    const archivos = [];
    for (const t of tarjetas) {
      archivos.push({ nombre: nombreArchivo(t.a, 'frente'), datos: await pngConPPP(t.frente) });
      archivos.push({ nombre: nombreArchivo(t.a, 'reverso'), datos: await pngConPPP(t.reverso) });
    }
    descargarBlob(zip(archivos), `credenciales-${new Date().toISOString().slice(0, 10)}.zip`);
    bz.disabled = false;
  });
  return m;
}
