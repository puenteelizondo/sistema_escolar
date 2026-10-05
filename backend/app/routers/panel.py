import calendar as cal
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Alumno, Curso, Evento, Inscripcion, Mensualidad, Pago, Usuario
from ..schemas import EventoIn
from ..security import get_current_user, require
from ..services import curso_dict, dias_aviso, log, mens_stmt, sync_estados
from ..utils import hoy, money

router = APIRouter(tags=["panel"])


def _suma_pagos(db: Session, desde: date, hasta: date) -> float:
    return money(db.scalar(select(func.coalesce(func.sum(Pago.importe), 0)).where(
        Pago.estado == "aplicado", Pago.fecha >= desde, Pago.fecha <= hasta)))


@router.get("/dashboard")
def dashboard(user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    sync_estados(db)
    h, aviso = hoy(), dias_aviso(db)
    d: dict = {"hoy": h, "dias_aviso": aviso}
    if user.es_instructor:
        # Los instructores solo ven sus cursos.
        cursos = db.scalars(select(Curso).where(Curso.instructor_id == (user.instructor_id or -1),
                                                Curso.estado.in_(["activo", "proximo", "inscripciones_abiertas"]))
                            .options(joinedload(Curso.plantel), joinedload(Curso.instructor))
                            .order_by(Curso.fecha_inicio)).unique().all()
        d["mis_cursos"] = [curso_dict(c) for c in cursos]
        return d

    d["alumnos_activos"] = db.scalar(select(func.count()).select_from(Alumno).where(Alumno.estado == "activo"))
    d["cursos_activos"] = db.scalar(select(func.count()).select_from(Curso).where(Curso.estado == "activo"))
    if not user.tiene("pagos.ver"):
        return d
    inicio_mes = h.replace(day=1)
    fin_mes = date(h.year, h.month, cal.monthrange(h.year, h.month)[1])
    d["pagos_dia"] = _suma_pagos(db, h, h)
    d["pagos_dia_cantidad"] = db.scalar(select(func.count()).select_from(Pago).where(
        Pago.estado == "aplicado", Pago.fecha == h))
    d["ingresos_mes"] = _suma_pagos(db, inicio_mes, fin_mes)

    saldo = Mensualidad.importe - Mensualidad.pagado
    base = lambda *c: mens_stmt(*c).where(saldo > 0, Alumno.estado != "baja")  # noqa: E731
    d["pagos_vencidos"] = db.scalar(base(func.count()).where(Mensualidad.fecha_limite < h))
    d["alumnos_vencidos"] = db.scalar(base(func.count(func.distinct(Alumno.id))).where(Mensualidad.fecha_limite < h))
    d["pagos_proximos"] = db.scalar(base(func.count()).where(
        Mensualidad.fecha_limite >= h, Mensualidad.fecha_limite <= h + timedelta(days=aviso)))
    d["total_adeudos"] = money(db.scalar(base(func.coalesce(func.sum(saldo), 0)).where(Mensualidad.fecha_limite < h)))

    d["proximos_cursos"] = [curso_dict(c) for c in db.scalars(
        select(Curso).where(Curso.estado.in_(["proximo", "inscripciones_abiertas"]), Curso.fecha_inicio >= h)
        .options(joinedload(Curso.plantel), joinedload(Curso.instructor)).order_by(Curso.fecha_inicio).limit(5)
    ).unique()]
    d["cursos_por_terminar"] = [curso_dict(c) for c in db.scalars(
        select(Curso).where(Curso.estado == "activo", Curso.fecha_fin <= h + timedelta(days=30))
        .options(joinedload(Curso.plantel), joinedload(Curso.instructor)).order_by(Curso.fecha_fin).limit(5)
    ).unique()]
    filas = db.execute(
        base(Alumno.id, Alumno.matricula, Alumno.nombre_completo, func.sum(saldo).label("saldo"),
             func.min(Mensualidad.fecha_limite).label("desde"), func.count().label("n"))
        .where(Mensualidad.fecha_limite < h)
        .group_by(Alumno.id, Alumno.matricula, Alumno.nombre_completo)
        .order_by(func.sum(saldo).desc()).limit(8)
    ).all()
    d["alumnos_con_adeudo"] = [{"alumno_id": r.id, "matricula": r.matricula, "nombre": r.nombre_completo,
                                "saldo": money(r.saldo), "dias_atraso": (h - r.desde).days, "cargos": r.n}
                               for r in filas]
    return d


# ---------------------------------------------------------------- calendario
DIAS = {"L": 0, "M": 1, "X": 2, "J": 3, "V": 4, "S": 5, "D": 6}


@router.get("/calendario")
def calendario(mes: str | None = None, user: Usuario = Depends(require("calendario.ver")),
               db: Session = Depends(get_db)):
    h = hoy()
    try:
        y, m = (int(x) for x in mes.split("-")) if mes else (h.year, h.month)
        primero = date(y, m, 1)
    except (ValueError, AttributeError):
        raise HTTPException(400, "Mes no válido (usa AAAA-MM)")
    ultimo = date(y, m, cal.monthrange(y, m)[1])
    items: list[dict] = []

    cq = select(Curso).where(Curso.estado != "cancelado", Curso.fecha_inicio <= ultimo, Curso.fecha_fin >= primero)
    if user.es_instructor:
        cq = cq.where(Curso.instructor_id == (user.instructor_id or -1))
    cursos = db.scalars(cq).all()
    ids = [c.id for c in cursos]
    for c in cursos:
        if primero <= c.fecha_inicio <= ultimo:
            items.append({"fecha": c.fecha_inicio, "tipo": "inicio", "titulo": f"Inicia: {c.nombre}",
                          "detalle": c.codigo, "curso_id": c.id})
        if primero <= c.fecha_fin <= ultimo:
            items.append({"fecha": c.fecha_fin, "tipo": "fin", "titulo": f"Termina: {c.nombre}",
                          "detalle": c.codigo, "curso_id": c.id})
        dias = {DIAS[x] for x in (c.dias_clase or "").replace(" ", "").split(",") if x in DIAS}
        if dias:
            d = max(primero, c.fecha_inicio)
            while d <= min(ultimo, c.fecha_fin):
                if d.weekday() in dias:
                    items.append({"fecha": d, "tipo": "clase", "titulo": f"Clase: {c.nombre}",
                                  "detalle": c.horario or "", "curso_id": c.id})
                d += timedelta(days=1)

    eq = select(Evento).where(Evento.fecha >= primero, Evento.fecha <= ultimo).options(joinedload(Evento.curso))
    if user.es_instructor:
        eq = eq.where(Evento.curso_id.in_(ids or [-1]))
    for e in db.scalars(eq):
        items.append({"fecha": e.fecha, "tipo": e.tipo, "titulo": e.titulo, "evento_id": e.id,
                      "detalle": (e.curso.nombre + " · " if e.curso else "") + (e.descripcion or ""),
                      "curso_id": e.curso_id})

    if user.tiene("pagos.ver"):
        saldo = Mensualidad.importe - Mensualidad.pagado
        filas = db.execute(
            mens_stmt(Mensualidad.fecha_limite, func.count(), func.sum(saldo))
            .where(saldo > 0, Mensualidad.fecha_limite >= primero, Mensualidad.fecha_limite <= ultimo)
            .group_by(Mensualidad.fecha_limite)
        ).all()
        for f, n, s in filas:
            items.append({"fecha": f, "tipo": "pago", "titulo": f"{n} pago(s) por vencer",
                          "detalle": f"Saldo ${money(s):,.0f}", "link": f"#/pagos?desde={f}&hasta={f}&estado=adeudo"})
    items.sort(key=lambda i: (i["fecha"], i["tipo"]))
    return {"mes": f"{y:04d}-{m:02d}", "items": items}


@router.get("/eventos")
def listar_eventos(user: Usuario = Depends(require("calendario.ver")), db: Session = Depends(get_db)):
    q = select(Evento).options(joinedload(Evento.curso)).where(Evento.fecha >= hoy() - timedelta(days=30)).order_by(Evento.fecha)
    return [{"id": e.id, "titulo": e.titulo, "tipo": e.tipo, "fecha": e.fecha, "descripcion": e.descripcion,
             "curso_id": e.curso_id, "curso": e.curso.nombre if e.curso else None} for e in db.scalars(q).unique()]


@router.post("/eventos", status_code=201)
def crear_evento(data: EventoIn, user: Usuario = Depends(require("eventos.admin")), db: Session = Depends(get_db)):
    e = Evento(**data.model_dump(), creado_por=user.id)
    db.add(e)
    db.flush()
    log(db, user, "crear_evento", "evento", e.id, f"{e.tipo}: {e.titulo} {e.fecha}")
    db.commit()
    return {"id": e.id}


@router.put("/eventos/{eid}")
def editar_evento(eid: int, data: EventoIn, user: Usuario = Depends(require("eventos.admin")), db: Session = Depends(get_db)):
    e = db.get(Evento, eid)
    if not e:
        raise HTTPException(404, "Evento no encontrado")
    for k, v in data.model_dump().items():
        setattr(e, k, v)
    log(db, user, "editar_evento", "evento", e.id, e.titulo)
    db.commit()
    return {"id": e.id}


@router.delete("/eventos/{eid}")
def borrar_evento(eid: int, user: Usuario = Depends(require("eventos.admin")), db: Session = Depends(get_db)):
    e = db.get(Evento, eid)
    if not e:
        raise HTTPException(404, "Evento no encontrado")
    log(db, user, "eliminar_evento", "evento", e.id, e.titulo)
    db.delete(e)
    db.commit()
    return {"ok": True}
