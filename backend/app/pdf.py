"""Generación de PDF: tickets y tablas de reportes."""
import base64
import io
from datetime import date, datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .utils import fecha_corta, fecha_ticket, fmt_money


# ---------------------------------------------------------------- ticket
def _logo(data_url: str):
    if not data_url or "," not in data_url:
        return None
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1])
        return ImageReader(io.BytesIO(raw))
    except Exception:
        return None


def _layout(t: dict, ancho: float):
    """Devuelve (operaciones, alto). Las y se miden desde arriba."""
    f = t.get("formato") or {}
    ops, y, pad = [], 4 * mm, 4 * mm
    inner = ancho - 2 * pad
    cx = ancho / 2

    def texto(txt, size=9, bold=False, align="left", gap=1.2, x=None):
        nonlocal y
        fuente = "Helvetica-Bold" if bold else "Helvetica"
        for linea in simpleSplit(str(txt), fuente, size, inner) or [""]:
            y += size * 1.15
            px = {"left": pad, "center": cx, "right": ancho - pad}[align] if x is None else x
            ops.append(("text", px, y, linea, fuente, size, align if x is None else "left"))
        y += gap * mm

    def linea(dash=False):
        nonlocal y
        y += 1 * mm
        ops.append(("line", y, dash))
        y += 2 * mm

    logo = _logo(f.get("logo", ""))
    if logo:
        iw, ih = logo.getSize()
        h = min(16 * mm, 30 * mm * ih / iw)
        w = h * iw / ih
        ops.append(("img", logo, cx - w / 2, y, w, h))
        y += h + 2 * mm
    elif f.get("escuela"):
        texto(f["escuela"], 9, True, "center", 1)
    texto(f.get("titulo") or "CONTROL DE PAGO", 11, True, "center", 2)
    linea()
    texto("PLANTEL", 7, False, "left", 0)
    texto(t.get("plantel") or "-", 10, True, "left", 2)
    # MATRÍCULA | IMPORTE
    y0 = y
    texto("MATRÍCULA", 7, False, "left", 0)
    texto(t["matricula"], 11, True, "left", 0)
    y_fin = y
    y = y0
    texto("IMPORTE", 7, False, "right", 0, x=None)
    texto(fmt_money(t["importe"]), 11, True, "right", 0)
    y = max(y, y_fin) + 2 * mm
    texto("MÓDULO", 7, False, "left", 0)
    texto(t["curso"], 10, True, "left", 2)
    if f.get("mostrar_concepto", True):
        texto("CONCEPTO", 7, False, "left", 0)
        texto(t["concepto"], 9, False, "left", 2)
    texto("NOMBRE", 7, False, "left", 0)
    texto(t["alumno"], 10, True, "left", 1)
    linea(dash=True)
    fecha = t["fecha"] if isinstance(t["fecha"], date) else date.fromisoformat(str(t["fecha"]))
    texto(fecha_ticket(fecha), 11, True, "center", 1)
    texto(f"No. {t['numero_texto']}", 14, True, "center", 1)
    if t.get("estado") == "cancelado":
        texto("*** PAGO CANCELADO ***", 10, True, "center", 1)
    if f.get("pie"):
        texto(f["pie"], 7, False, "center", 0)
    y += 2 * mm
    return ops, y + 2 * mm


def ticket_pdf(t: dict) -> bytes:
    f = t.get("formato") or {}
    ancho_cfg = str(f.get("ancho", "80"))
    carta = ancho_cfg == "carta"
    ancho = 80 * mm if carta else (58 if ancho_cfg == "58" else 80) * mm
    ops, alto = _layout(t, ancho)
    buf = io.BytesIO()
    if carta:
        c = canvas.Canvas(buf, pagesize=letter)
        ox, oy_top = 20 * mm, letter[1] - 20 * mm
    else:
        c = canvas.Canvas(buf, pagesize=(ancho, alto))
        ox, oy_top = 0, alto
    c.setTitle(f"Ticket {t['numero_texto']}")
    c.setLineWidth(0.8)
    c.rect(ox + 1 * mm, oy_top - alto + 1 * mm, ancho - 2 * mm, alto - 2 * mm)
    for op in ops:
        if op[0] == "text":
            _, x, y, txt, font, size, align = op
            c.setFont(font, size)
            py = oy_top - y
            if align == "center":
                c.drawCentredString(ox + x, py, txt)
            elif align == "right":
                c.drawRightString(ox + x, py, txt)
            else:
                c.drawString(ox + x, py, txt)
        elif op[0] == "line":
            _, y, dash = op
            c.setDash(2, 2) if dash else c.setDash()
            c.line(ox + 4 * mm, oy_top - y, ox + ancho - 4 * mm, oy_top - y)
            c.setDash()
        elif op[0] == "img":
            _, img, x, y, w, h = op
            c.drawImage(img, ox + x, oy_top - y - h, w, h, mask="auto")
    c.showPage()
    c.save()
    return buf.getvalue()


# ---------------------------------------------------------------- reportes
def _fmt(v, tipo):
    if v is None:
        return ""
    if tipo == "money":
        return fmt_money(v)
    if tipo == "date":
        return fecha_corta(v) if isinstance(v, (date, datetime)) else str(v)
    if tipo == "pct":
        return f"{v}%"
    return str(v)


def tabla_pdf(titulo: str, columnas: list[dict], filas: list[dict], subtitulo: str = "",
              escuela: str = "", resumen: list[tuple[str, str]] | None = None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(letter), leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm, title=titulo)
    st = getSampleStyleSheet()
    el = [Paragraph(f"<b>{escuela}</b>" if escuela else "", st["Normal"]),
          Paragraph(titulo, st["Title"])]
    if subtitulo:
        el.append(Paragraph(subtitulo, st["Normal"]))
    el.append(Spacer(1, 4 * mm))
    celda = st["BodyText"].clone("celda", fontSize=8, leading=9.5)
    cab = st["BodyText"].clone("cab", fontSize=8, leading=9.5, textColor=colors.white, fontName="Helvetica-Bold")
    data = [[Paragraph(c["label"], cab) for c in columnas]]
    for fila in filas:
        data.append([Paragraph(_esc(_fmt(fila.get(c["key"]), c.get("tipo"))), celda) for c in columnas])
    if not filas:
        data.append([Paragraph("Sin resultados", celda)] + [""] * (len(columnas) - 1))
    tabla = Table(data, repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    el.append(tabla)
    if resumen:
        el.append(Spacer(1, 4 * mm))
        for k, v in resumen:
            el.append(Paragraph(f"<b>{k}:</b> {v}", st["Normal"]))
    el.append(Spacer(1, 3 * mm))
    el.append(Paragraph(f"Generado el {datetime.now().strftime('%d/%m/%Y %H:%M')} · {len(filas)} registro(s)",
                        st["Normal"]))
    doc.build(el)
    return buf.getvalue()


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
