import calendar as cal
import io
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Alumno, Asistencia, Curso, Inscripcion, Instructor, Mensualidad, Pago, Plantel, Ticket, Usuario
from ..asistencia_excel import logo_bytes
from ..excel_reportes import reporte_excel
from ..pdf import tabla_pdf
from ..security import require
from ..services import (
    PAGO_COLS, cfg_get, dias_aviso, estados_pago_alumnos, etiqueta_mens, filtrar_pagos, log, mens_stmt,
    pagos_stmt, pago_row_dict,
)
from ..utils import fecha_corta, hoy, money, num_ticket
from .asistencia import stats as stats_asistencia

router = APIRouter(tags=["reportes"])


def C(key, label, tipo=None):
    return {"key": key, "label": label, "tipo": tipo}


F_PAGOS = ["desde", "hasta", "curso_id", "plantel_id", "usuario_id", "metodo"]
CATALOGO = {
    "alumnos_activos": ("Alumnos activos", ["plantel_id"]),
    "alumnos_por_curso": ("Alumnos por curso", ["curso_id"]),
    "alumnos_por_plantel": ("Alumnos por plantel", ["plantel_id"]),
    "alumnos_baja": ("Alumnos dados de baja", ["plantel_id"]),
    "cursos_activos": ("Cursos activos", ["plantel_id"]),
    "cursos_terminados": ("Cursos terminados", ["plantel_id"]),
    "pagos_dia": ("Pagos del día", ["fecha", "curso_id", "plantel_id", "usuario_id", "metodo"]),
    "pagos_mes": ("Pagos del mes", ["mes", "curso_id", "plantel_id", "usuario_id", "metodo"]),
    "pagos_fechas": ("Pagos por fechas", F_PAGOS),
    "pagos_pendientes": ("Pagos pendientes", ["desde", "hasta", "curso_id", "plantel_id"]),
    "pagos_vencidos": ("Pagos vencidos", ["curso_id", "plantel_id"]),
    "ingresos": ("Ingresos", F_PAGOS),
    "asistencia": ("Asistencia por curso", ["curso_id", "desde", "hasta"]),
    "historial_alumno": ("Historial de alumno", ["matricula"]),
    "historial_tickets": ("Historial de tickets", ["desde", "hasta", "q"]),
}


@router.get("/reportes")
def catalogo(user: Usuario = Depends(require("reportes.ver"))):
    return [{"key": k, "nombre": v[0], "filtros": v[1]} for k, v in CATALOGO.items()]


# ---------------------------------------------------------------- constructores
def _estado_pago_txt(e):
    return {"al_corriente": "Al corriente", "por_vencer": "Próximo a vencer", "vencido": "Vencido",
            "sin_curso": "Sin curso activo"}.get(e, e)


def r_alumnos(db, p, estado=None, titulo=""):
    stmt = select(Alumno).outerjoin(Plantel, Plantel.id == Alumno.plantel_id)
    if estado:
        stmt = stmt.where(Alumno.estado == estado)
    if p.get("plantel_id"):
        stmt = stmt.where(Alumno.plantel_id == p["plantel_id"])
    alumnos = db.scalars(stmt.order_by(Alumno.nombre_completo)).unique().all()
    est = estados_pago_alumnos(db, [a.id for a in alumnos])
    cursos = {}
    for aid, nom in db.execute(select(Inscripcion.alumno_id, Curso.nombre).join(Curso, Curso.id == Inscripcion.curso_id)
                               .where(Inscripcion.estado == "activa")):
        cursos.setdefault(aid, []).append(nom)
    filas = [{"matricula": a.matricula, "alumno": a.nombre_completo, "plantel": a.plantel.nombre if a.plantel else "",
              "telefono": a.telefono or a.whatsapp or "", "curso": ", ".join(cursos.get(a.id, [])),
              "estado": a.estado.capitalize(), "pago": _estado_pago_txt(est.get(a.id))} for a in alumnos]
    return dict(titulo=titulo, columnas=[C("matricula", "Matrícula"), C("alumno", "Alumno"), C("plantel", "Plantel"),
                                         C("telefono", "Teléfono"), C("curso", "Curso activo"),
                                         C("estado", "Estado"), C("pago", "Estado de pago")], filas=filas)


def r_alumnos_por_curso(db, p):
    stmt = (select(Inscripcion, Alumno.matricula, Alumno.nombre_completo, Curso.nombre, Curso.codigo, Plantel.nombre)
            .join(Alumno, Alumno.id == Inscripcion.alumno_id).join(Curso, Curso.id == Inscripcion.curso_id)
            .outerjoin(Plantel, Plantel.id == Inscripcion.plantel_id).where(Inscripcion.estado != "retirada"))
    if p.get("curso_id"):
        stmt = stmt.where(Inscripcion.curso_id == p["curso_id"])
    filas = [{"curso": f"{c} ({cod})", "matricula": m, "alumno": a, "plantel": pl or "", "inicio": i.fecha_inicio,
              "fin": i.fecha_fin, "estado": i.estado.capitalize()}
             for i, m, a, c, cod, pl in db.execute(stmt.order_by(Curso.nombre, Alumno.nombre_completo))]
    return dict(titulo="Alumnos por curso", columnas=[C("curso", "Curso"), C("matricula", "Matrícula"),
                C("alumno", "Alumno"), C("plantel", "Plantel"), C("inicio", "Inicio", "date"),
                C("fin", "Terminación", "date"), C("estado", "Estado")], filas=filas)


def r_alumnos_por_plantel(db, p):
    stmt = select(Alumno).outerjoin(Plantel, Plantel.id == Alumno.plantel_id)
    if p.get("plantel_id"):
        stmt = stmt.where(Alumno.plantel_id == p["plantel_id"])
    filas = [{"plantel": a.plantel.nombre if a.plantel else "Sin plantel", "matricula": a.matricula,
              "alumno": a.nombre_completo, "estado": a.estado.capitalize(), "telefono": a.telefono or ""}
             for a in sorted(db.scalars(stmt).unique(), key=lambda a: ((a.plantel.nombre if a.plantel else "~"), a.nombre_completo))]
    por = {}
    for f in filas:
        por[f["plantel"]] = por.get(f["plantel"], 0) + 1
    return dict(titulo="Alumnos por plantel", columnas=[C("plantel", "Plantel"), C("matricula", "Matrícula"),
                C("alumno", "Alumno"), C("estado", "Estado"), C("telefono", "Teléfono")], filas=filas,
                resumen=[(k, str(v)) for k, v in por.items()])


def r_cursos(db, p, estado, titulo):
    stmt = select(Curso).where(Curso.estado == estado)
    if p.get("plantel_id"):
        stmt = stmt.where(Curso.plantel_id == p["plantel_id"])
    cursos = db.scalars(stmt.order_by(Curso.fecha_inicio.desc())).all()
    n = dict(db.execute(select(Inscripcion.curso_id, func.count()).where(Inscripcion.estado != "retirada")
                        .group_by(Inscripcion.curso_id)).all())
    filas = [{"codigo": c.codigo, "curso": c.nombre, "plantel": c.plantel.nombre if c.plantel else "",
              "instructor": c.instructor.nombre if c.instructor else "", "inicio": c.fecha_inicio,
              "fin": c.fecha_fin, "inscritos": n.get(c.id, 0), "cupo": c.cupo_maximo,
              "mensualidad": c.costo_mensualidad} for c in cursos]
    return dict(titulo=titulo, columnas=[C("codigo", "Código"), C("curso", "Curso"), C("plantel", "Plantel"),
                C("instructor", "Instructor"), C("inicio", "Inicio", "date"), C("fin", "Terminación", "date"),
                C("inscritos", "Inscritos"), C("cupo", "Cupo"), C("mensualidad", "Mensualidad", "money")], filas=filas)


def r_pagos(db, p, titulo, subtitulo=""):
    stmt = filtrar_pagos(pagos_stmt(*PAGO_COLS()), p)
    rows = [pago_row_dict(r) for r in db.execute(stmt.order_by(Pago.fecha, Pago.id)).all()]
    total = sum(r["importe"] for r in rows if r["estado"] == "aplicado")
    canc = sum(1 for r in rows if r["estado"] == "cancelado")
    for r in rows:
        r["estado"] = r["estado"].capitalize()
    resumen = [("Total cobrado", f"${total:,.2f}"), ("Pagos", str(len(rows) - canc))]
    if canc:
        resumen.append(("Pagos cancelados (no suman)", str(canc)))
    return dict(titulo=titulo, subtitulo=subtitulo, filas=rows, resumen=resumen,
                columnas=[C("ticket", "Ticket"), C("fecha", "Fecha", "date"), C("matricula", "Matrícula"),
                          C("alumno", "Alumno"), C("curso", "Curso"), C("concepto", "Concepto"),
                          C("importe", "Importe", "money"), C("metodo", "Método"), C("usuario", "Usuario"),
                          C("estado", "Estado")])


def r_mensualidades(db, p, vencidos: bool, titulo):
    h = hoy()
    saldo = Mensualidad.importe - Mensualidad.pagado
    stmt = mens_stmt(Mensualidad, Alumno.matricula, Alumno.nombre_completo, Curso.nombre, Plantel.nombre) \
        .where(saldo > 0, Alumno.estado != "baja")
    stmt = stmt.where(Mensualidad.fecha_limite < h) if vencidos else stmt.where(Mensualidad.fecha_limite >= h)
    if p.get("curso_id"):
        stmt = stmt.where(Curso.id == p["curso_id"])
    if p.get("plantel_id"):
        stmt = stmt.where(Inscripcion.plantel_id == p["plantel_id"])
    if p.get("desde"):
        stmt = stmt.where(Mensualidad.fecha_limite >= p["desde"])
    if p.get("hasta"):
        stmt = stmt.where(Mensualidad.fecha_limite <= p["hasta"])
    filas, total = [], 0.0
    for m, mat, alumno, curso, plantel in db.execute(stmt.order_by(Mensualidad.fecha_limite, Alumno.nombre_completo)):
        s = money(m.saldo)
        total += s
        filas.append({"matricula": mat, "alumno": alumno, "curso": curso, "plantel": plantel or "",
                      "concepto": etiqueta_mens(m.concepto, m.numero), "fecha_limite": m.fecha_limite,
                      "dias": (h - m.fecha_limite).days if vencidos else (m.fecha_limite - h).days,
                      "importe": money(m.importe), "pagado": money(m.pagado), "saldo": s})
    return dict(titulo=titulo, filas=filas, resumen=[("Saldo total", f"${total:,.2f}")],
                columnas=[C("matricula", "Matrícula"), C("alumno", "Alumno"), C("curso", "Curso"),
                          C("plantel", "Plantel"), C("concepto", "Concepto"), C("fecha_limite", "Fecha límite", "date"),
                          C("dias", "Días de atraso" if vencidos else "Días para vencer"), C("importe", "Importe", "money"),
                          C("pagado", "Pagado", "money"), C("saldo", "Saldo", "money")])


def r_ingresos(db, p):
    p = {**p, "estado": "aplicado"}
    stmt = filtrar_pagos(pagos_stmt(Pago.fecha, func.count(), func.sum(Pago.importe)), p).group_by(Pago.fecha).order_by(Pago.fecha)
    filas = [{"fecha": f, "cantidad": n, "total": money(t)} for f, n, t in db.execute(stmt)]
    por_metodo = filtrar_pagos(pagos_stmt(Pago.metodo, func.sum(Pago.importe)), p).group_by(Pago.metodo)
    resumen = [(f"Total {m}", f"${money(t):,.2f}") for m, t in db.execute(por_metodo)]
    resumen.insert(0, ("TOTAL", f"${sum(f['total'] for f in filas):,.2f}"))
    return dict(titulo="Ingresos", filas=filas, resumen=resumen,
                columnas=[C("fecha", "Fecha", "date"), C("cantidad", "Pagos"), C("total", "Total", "money")])


def r_asistencia(db, p):
    if not p.get("curso_id"):
        raise HTTPException(400, "Selecciona un curso")
    c = db.get(Curso, p["curso_id"])
    if not c:
        raise HTTPException(404, "Curso no encontrado")
    q = select(Asistencia.inscripcion_id, Asistencia.estado).where(Asistencia.curso_id == c.id)
    if p.get("desde"):
        q = q.where(Asistencia.fecha >= p["desde"])
    if p.get("hasta"):
        q = q.where(Asistencia.fecha <= p["hasta"])
    por = {}
    for iid, e in db.execute(q):
        por.setdefault(iid, []).append(e)
    inscs = db.execute(select(Inscripcion.id, Alumno.matricula, Alumno.nombre_completo)
                       .join(Alumno, Alumno.id == Inscripcion.alumno_id)
                       .where(Inscripcion.curso_id == c.id, Inscripcion.estado != "retirada")
                       .order_by(Alumno.nombre_completo)).all()
    filas = []
    for iid, mat, nom in inscs:
        s = stats_asistencia(por.get(iid, []))
        filas.append({"matricula": mat, "alumno": nom, "asistencias": s["asistencias"], "faltas": s["faltas"],
                      "retardos": s["retardos"], "justificadas": s["justificadas"], "porcentaje": s["porcentaje"]})
    return dict(titulo=f"Asistencia · {c.nombre}", filas=filas,
                columnas=[C("matricula", "Matrícula"), C("alumno", "Alumno"), C("asistencias", "Asistencias"),
                          C("faltas", "Faltas"), C("retardos", "Retardos"), C("justificadas", "Justificadas"),
                          C("porcentaje", "% asistencia", "pct")])


def r_historial_alumno(db, p):
    mat = (p.get("matricula") or "").strip().upper()
    a = db.scalar(select(Alumno).where(Alumno.matricula == mat)) if mat else None
    if not a:
        raise HTTPException(404, "Escribe una matrícula existente")
    filas = []
    for i, c in db.execute(select(Inscripcion, Curso).join(Curso, Curso.id == Inscripcion.curso_id)
                           .where(Inscripcion.alumno_id == a.id)):
        filas.append({"fecha": i.fecha_inscripcion, "tipo": "Curso",
                      "detalle": f"{c.nombre} · {fecha_corta(i.fecha_inicio)} al {fecha_corta(i.fecha_fin)}",
                      "importe": None, "estado": i.estado.capitalize()})
    for r in db.execute(pagos_stmt(*PAGO_COLS()).where(Alumno.id == a.id)).all():
        d = pago_row_dict(r)
        filas.append({"fecha": d["fecha"], "tipo": "Pago", "detalle": f"Ticket {d['ticket']} · {d['concepto']} · {d['curso']} · {d['metodo']}",
                      "importe": d["importe"], "estado": d["estado"].capitalize()})
    filas.sort(key=lambda f: f["fecha"])
    return dict(titulo=f"Historial de {a.nombre_completo} ({a.matricula})", filas=filas,
                columnas=[C("fecha", "Fecha", "date"), C("tipo", "Tipo"), C("detalle", "Detalle"),
                          C("importe", "Importe", "money"), C("estado", "Estado")])


def r_tickets(db, p):
    stmt = (select(Ticket, Pago.metodo, Pago.estado, Usuario.nombre).join(Pago, Pago.id == Ticket.pago_id)
            .outerjoin(Usuario, Usuario.id == Pago.usuario_id))
    if p.get("desde"):
        stmt = stmt.where(Ticket.fecha >= p["desde"])
    if p.get("hasta"):
        stmt = stmt.where(Ticket.fecha <= p["hasta"])
    if p.get("q"):
        t = p["q"].strip()
        cond = [Ticket.matricula.ilike(f"%{t.upper()}%"), Ticket.alumno.ilike(f"%{t}%")]
        if t.isdigit():
            cond.append(Ticket.numero == int(t))
        stmt = stmt.where(or_(*cond))
    filas = [{"numero": num_ticket(t.numero), "fecha": t.fecha, "matricula": t.matricula, "alumno": t.alumno,
              "curso": t.curso, "concepto": t.concepto, "importe": money(t.importe), "metodo": m,
              "usuario": u or "", "estado": e.capitalize()} for t, m, e, u in db.execute(stmt.order_by(Ticket.numero))]
    return dict(titulo="Historial de tickets", filas=filas,
                columnas=[C("numero", "Ticket"), C("fecha", "Fecha", "date"), C("matricula", "Matrícula"),
                          C("alumno", "Alumno"), C("curso", "Curso"), C("concepto", "Concepto"),
                          C("importe", "Importe", "money"), C("metodo", "Método"), C("usuario", "Usuario"),
                          C("estado", "Estado")])


def construir(db: Session, key: str, p: dict) -> dict:
    if key == "alumnos_activos":
        return r_alumnos(db, p, "activo", "Alumnos activos")
    if key == "alumnos_baja":
        return r_alumnos(db, p, "baja", "Alumnos dados de baja")
    if key == "alumnos_por_curso":
        return r_alumnos_por_curso(db, p)
    if key == "alumnos_por_plantel":
        return r_alumnos_por_plantel(db, p)
    if key == "cursos_activos":
        return r_cursos(db, p, "activo", "Cursos activos")
    if key == "cursos_terminados":
        return r_cursos(db, p, "terminado", "Cursos terminados")
    if key == "pagos_dia":
        f = p.get("fecha") or hoy()
        return r_pagos(db, {**p, "desde": f, "hasta": f}, "Pagos del día", fecha_corta(f))
    if key == "pagos_mes":
        try:
            y, m = (int(x) for x in (p.get("mes") or hoy().strftime("%Y-%m")).split("-"))
            ini, fin = date(y, m, 1), date(y, m, cal.monthrange(y, m)[1])
        except ValueError:
            raise HTTPException(400, "Mes no válido")
        return r_pagos(db, {**p, "desde": ini, "hasta": fin}, "Pagos del mes", f"{ini.strftime('%m/%Y')}")
    if key == "pagos_fechas":
        return r_pagos(db, p, "Pagos por fechas", f"{fecha_corta(p.get('desde')) or 'inicio'} al {fecha_corta(p.get('hasta')) or 'hoy'}")
    if key == "pagos_pendientes":
        return r_mensualidades(db, p, False, "Pagos pendientes")
    if key == "pagos_vencidos":
        return r_mensualidades(db, p, True, "Pagos vencidos")
    if key == "ingresos":
        return r_ingresos(db, p)
    if key == "asistencia":
        return r_asistencia(db, p)
    if key == "historial_alumno":
        return r_historial_alumno(db, p)
    if key == "historial_tickets":
        return r_tickets(db, p)
    raise HTTPException(404, "Reporte no encontrado")


# ---------------------------------------------------------------- exportar
@router.get("/reportes/{key}")
def reporte(key: str, formato: str = "json", fecha: date | None = None, mes: str | None = None,
            desde: date | None = None, hasta: date | None = None, curso_id: int | None = None,
            plantel_id: int | None = None, usuario_id: int | None = None, metodo: str | None = None,
            matricula: str | None = None, q: str | None = None, limite: int = Query(500, ge=1, le=5000),
            user: Usuario = Depends(require("reportes.ver")), db: Session = Depends(get_db)):
    p = dict(fecha=fecha, mes=mes, desde=desde, hasta=hasta, curso_id=curso_id, plantel_id=plantel_id,
             usuario_id=usuario_id, metodo=metodo, matricula=matricula, q=q)
    rep = construir(db, key, p)
    if formato == "json":
        # Vista previa en pantalla acotada; Excel y PDF siempre incluyen todo.
        total = len(rep["filas"])
        return {**rep, "filas": rep["filas"][:limite], "total": total, "truncado": total > limite}
    nombre = f"{key}-{hoy().isoformat()}"
    log(db, user, "exportar_reporte", "reporte", None, f"{key} ({formato})")
    db.commit()
    if formato == "xlsx":
        return Response(reporte_excel(rep, cfg_get(db, "escuela_nombre"), logo_bytes(cfg_get(db, "logo"))), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{nombre}.xlsx"'})
    if formato == "pdf":
        pdf = tabla_pdf(rep["titulo"], rep["columnas"], rep["filas"], rep.get("subtitulo", ""),
                        cfg_get(db, "escuela_nombre"), rep.get("resumen"))
        return Response(pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{nombre}.pdf"'})
    raise HTTPException(400, "Formato no válido")


# ---------------------------------------------------------------- control financiero
@router.get("/finanzas/resumen")
def finanzas(curso_id: int | None = None, plantel_id: int | None = None, usuario_id: int | None = None,
             metodo: str | None = None, user: Usuario = Depends(require("reportes.ver", "pagos.ver")),
             db: Session = Depends(get_db)):
    h = hoy()
    base = dict(curso_id=curso_id, plantel_id=plantel_id, usuario_id=usuario_id, metodo=metodo, estado="aplicado")

    def suma(desde, hasta):
        s = filtrar_pagos(pagos_stmt(func.coalesce(func.sum(Pago.importe), 0)), {**base, "desde": desde, "hasta": hasta})
        return money(db.scalar(s))

    lunes = h - timedelta(days=h.weekday())
    saldo = Mensualidad.importe - Mensualidad.pagado

    def mens(vencido):
        s = mens_stmt(func.count(), func.coalesce(func.sum(saldo), 0)).where(saldo > 0, Alumno.estado != "baja")
        s = s.where(Mensualidad.fecha_limite < h) if vencido else s.where(Mensualidad.fecha_limite >= h)
        if curso_id:
            s = s.where(Curso.id == curso_id)
        if plantel_id:
            s = s.where(Inscripcion.plantel_id == plantel_id)
        n, t = db.execute(s).one()
        return n, money(t)

    nv, sv = mens(True)
    npnd, spnd = mens(False)
    return {
        "dia": suma(h, h), "semana": suma(lunes, h), "mes": suma(h.replace(day=1), h),
        "anio": suma(date(h.year, 1, 1), h), "pagos_vencidos": nv, "total_adeudos": sv,
        "pagos_pendientes": npnd, "saldo_pendiente": spnd,
    }
