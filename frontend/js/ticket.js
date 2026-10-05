// Ticket de pago: vista previa, impresión (térmica / normal) y PDF.
import { get, post, url } from './api.js';
import { html, esc, fdateTicket, money, modal, on, toast, spinner, setHTML } from './ui.js';

const ESTILO_TICKET = `
  *{box-sizing:border-box}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
  .tk{border:1.5px solid #000;padding:3mm 4mm;width:100%;font-size:11px;line-height:1.25}
  .tk .logo{text-align:center;margin-bottom:2mm}
  .tk .logo img{max-width:38mm;max-height:16mm}
  .tk .escuela{text-align:center;font-weight:bold;font-size:11px;margin-bottom:1mm}
  .tk .titulo{text-align:center;font-weight:bold;font-size:14px;letter-spacing:.3px;margin:1mm 0 2mm}
  .tk hr{border:0;border-top:1.2px solid #000;margin:2mm 0}
  .tk hr.dash{border-top:1.2px dashed #000}
  .tk .lbl{font-size:8px;letter-spacing:.5px;color:#222;text-transform:uppercase;margin-top:1.5mm}
  .tk .val{font-weight:bold;font-size:13px;word-break:break-word}
  .tk .val.big{font-size:15px}
  .tk .fila{display:flex;justify-content:space-between;gap:3mm;align-items:flex-end}
  .tk .der{text-align:right}
  .tk .fecha{text-align:center;font-weight:bold;font-size:14px;margin-top:1mm}
  .tk .num{text-align:center;font-weight:bold;font-size:20px;margin:1mm 0}
  .tk .pie{text-align:center;font-size:9px;margin-top:1mm}
  .tk .cancelado{text-align:center;font-weight:bold;font-size:13px;border:2px solid #000;padding:1mm;margin:1.5mm 0;transform:rotate(-3deg)}
`;

export function ticketHTML(t) {
  const f = t.formato || {};
  return html`<div class="tk">
    ${f.logo ? html`<div class="logo"><img src="${f.logo}" alt=""></div>` : (f.escuela ? html`<div class="escuela">${f.escuela}</div>` : '')}
    <div class="titulo">${f.titulo || 'CONTROL DE PAGO'}</div>
    <hr>
    <div class="lbl">Plantel</div><div class="val">${t.plantel || '—'}</div>
    <div class="fila">
      <div><div class="lbl">Matrícula</div><div class="val big">${t.matricula}</div></div>
      <div class="der"><div class="lbl">Importe</div><div class="val big">${money(t.importe)}</div></div>
    </div>
    <div class="lbl">Módulo</div><div class="val">${t.curso}</div>
    ${f.mostrar_concepto !== false ? html`<div class="lbl">Concepto</div><div style="font-size:12px">${t.concepto}</div>` : ''}
    <div class="lbl">Nombre</div><div class="val">${t.alumno}</div>
    <hr class="dash">
    <div class="fecha">${fdateTicket(t.fecha)}</div>
    <div class="num">No. ${t.numero_texto}</div>
    ${t.estado === 'cancelado' ? html`<div class="cancelado">PAGO CANCELADO</div>` : ''}
    ${f.pie ? html`<div class="pie">${f.pie}</div>` : ''}
  </div>`;
}

export function ticketPreview(t) {
  return html`<div class="tk-preview" data-ancho="${(t.formato && t.formato.ancho) || '80'}">${ticketHTML(t)}</div>`;
}

/** Imprime el ticket con un iframe oculto (rápido, sin abrir pestañas). */
export async function imprimirTicket(t, { registrar = true } = {}) {
  const ancho = String((t.formato && t.formato.ancho) || '80');
  const carta = ancho === 'carta';
  const mm = carta ? 80 : Number(ancho);
  const page = carta ? '@page{size:letter;margin:15mm}' : `@page{size:${mm}mm auto;margin:0}`;
  const cuerpo = carta ? `<div style="width:80mm">${ticketHTML(t)}</div>` : `<div style="width:${mm}mm;padding:1mm">${ticketHTML(t)}</div>`;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${esc(t.numero_texto)}</title><style>${page}${ESTILO_TICKET}</style></head><body>${cuerpo}</body></html>`);
  doc.close();
  const imgs = [...doc.images];
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  const limpiar = () => setTimeout(() => iframe.remove(), 1500);
  iframe.contentWindow.onafterprint = limpiar;
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(limpiar, 60000);
  }, 80);
  if (registrar) {
    try { await post(`/tickets/${t.id}/impresion`); } catch { /* no bloquea la impresión */ }
  }
}

export const pdfURL = (id) => url(`/tickets/${id}/pdf`);

export async function verTicket(id, { puedeImprimir = true } = {}) {
  const m = modal({ titulo: 'Ticket', ancho: 'sm', cuerpo: spinner() });
  try {
    const t = await get(`/tickets/${id}`);
    m.setTitulo(`Ticket No. ${t.numero_texto}`);
    setHTML(m.body, html`${ticketPreview(t)}
      <div class="modal-actions center">
        ${puedeImprimir ? html`<button class="btn primary" data-imprimir>🖨 Imprimir</button>` : ''}
        <a class="btn" href="${pdfURL(id)}" target="_blank" rel="noopener">Descargar PDF</a>
      </div>`);
    on(m.body, 'click', '[data-imprimir]', () => imprimirTicket(t));
    return t;
  } catch (e) {
    m.close();
    toast(e.message, 'error');
  }
}

export async function imprimirPorId(id) {
  try {
    const t = await get(`/tickets/${id}`);
    await imprimirTicket(t);
  } catch (e) {
    toast(e.message, 'error');
  }
}
