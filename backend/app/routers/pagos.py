from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Alumno, Curso, Inscripcion, Mensualidad, Pago, Plantel, Ticket, Usuario
from ..pdf import ticket_pdf
from ..schemas import CancelarPagoIn, PagoIn
from ..security import require
from ..services import (
    PAGO_COLS, cancelar_pago, dias_aviso, filtrar_pagos, formato_ticket, log, mens_dict, mens_stmt,
    pago_row_dict, pagos_stmt, registrar_pago, resumen_cobro, ticket_dict,
)
from ..utils import hoy, money, num_ticket

router = APIRouter(tags=["pagos"])


@router.get("/cobro/{matricula}")
def cobro(matricula: str, user: Usuario = Depends(require("pagos.registrar", "pagos.ver")),
          db: Session = Depends(get_db)):
    """Cobro rápido: busca por matrícula exacta y devuelve todo para cobrar."""
    m = matricula.strip().upper().replace(" ", "")
    a = db.scalar(select(Alumno).where(Alumno.matricula == m))
    if not a:
        raise HTTPException(404, f"No se encontró la matrícula {m}")
    return resumen_cobro(db, a)


@router.get("/metodos-pago")
def listar_metodos(user: Usuario = Depends(require("pagos.ver", "pagos.registrar", "reportes.ver")),
                   db: Session = Depends(get_db)):
    from ..services import metodos_pago
    return metodos_pago(db)


@router.post("/pagos", status_code=201)
def crear_pago(data: PagoIn, user: Usuario = Depends(require("pagos.registrar")), db: Session = Depends(get_db)):
    if data.fecha and data.fecha != hoy() and not user.tiene("mensualidades.editar"):
        raise HTTPException(403, "Solo un administrador puede registrar pagos con otra fecha")
    pago, ticket = registrar_pago(db, user, data.mensualidad_id, data.importe, data.metodo,
                                  data.fecha, data.referencia)
    db.commit()
    return {"pago_id": pago.id, "ticket": ticket_dict(ticket, pago, formato_ticket(db))}


@router.post("/pagos/{pid}/cancelar")
def cancelar(pid: int, data: CancelarPagoIn, user: Usuario = Depends(require("pagos.cancelar")),
             db: Session = Depends(get_db)):
    cancelar_pago(db, user, pid, data.motivo)
    db.commit()
    return {"ok": True}


def _filtros(q, desde, hasta, curso_id, plantel_id, usuario_id, metodo, estado) -> dict:
    return dict(q=q, desde=desde, hasta=hasta, curso_id=curso_id, plantel_id=plantel_id,
                usuario_id=usuario_id, metodo=metodo, estado=estado)


@router.get("/pagos")
def listar_pagos(q: str | None = None, desde: date | None = None, hasta: date | None = None,
                 curso_id: int | None = None, plantel_id: int | None = None, usuario_id: int | None = None,
                 metodo: str | None = None, estado: str | None = None,
                 limit: int = Query(100, le=500), offset: int = 0,
                 user: Usuario = Depends(require("pagos.ver")), db: Session = Depends(get_db)):
    f = _filtros(q, desde, hasta, curso_id, plantel_id, usuario_id, metodo, estado)
    stmt = filtrar_pagos(pagos_stmt(*PAGO_COLS()), f)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    suma = db.scalar(filtrar_pagos(pagos_stmt(func.coalesce(func.sum(Pago.importe), 0)), {**f, "estado": "aplicado"}))
    rows = db.execute(stmt.order_by(Pago.fecha.desc(), Pago.id.desc()).limit(limit).offset(offset)).all()
    return {"total": total, "suma": money(suma), "items": [pago_row_dict(r) for r in rows]}


def _filtrar_mens(stmt, h, aviso, estado, q, curso_id, plantel_id, desde, hasta):
    saldo = Mensualidad.importe - Mensualidad.pagado
    if estado in ("adeudo", "vencido", "por_vencer", "pendiente", "parcial"):
        stmt = stmt.where(saldo > 0)
    if estado == "vencido":
        stmt = stmt.where(Mensualidad.fecha_limite < h)
    elif estado == "por_vencer":
        stmt = stmt.where(Mensualidad.fecha_limite >= h, Mensualidad.fecha_limite <= h + timedelta(days=aviso))
    elif estado == "pendiente":
        stmt = stmt.where(Mensualidad.fecha_limite >= h, Mensualidad.pagado == 0)
    elif estado == "parcial":
        stmt = stmt.where(Mensualidad.fecha_limite >= h, Mensualidad.pagado > 0)
    elif estado == "pagado":
        stmt = stmt.where(saldo <= 0)
    if q:
        t = q.strip()
        stmt = stmt.where(or_(Alumno.matricula.ilike(f"%{t.upper()}%"), Alumno.nombre_completo.ilike(f"%{t}%")))
    if curso_id:
        stmt = stmt.where(Curso.id == curso_id)
    if plantel_id:
        stmt = stmt.where(Inscripcion.plantel_id == plantel_id)
    if desde:
        stmt = stmt.where(Mensualidad.fecha_limite >= desde)
    if hasta:
        stmt = stmt.where(Mensualidad.fecha_limite <= hasta)
    return stmt


@router.get("/mensualidades")
def listar_mensualidades(estado: str | None = None, q: str | None = None, curso_id: int | None = None,
                         plantel_id: int | None = None, desde: date | None = None, hasta: date | None = None,
                         limit: int = Query(200, le=1000), offset: int = 0,
                         user: Usuario = Depends(require("pagos.ver")), db: Session = Depends(get_db)):
    """estado: adeudo | vencido | por_vencer | pendiente | parcial | pagado"""
    h, aviso = hoy(), dias_aviso(db)
    args = (h, aviso, estado, q, curso_id, plantel_id, desde, hasta)
    stmt = _filtrar_mens(mens_stmt(Mensualidad, Alumno.matricula, Alumno.nombre_completo,
                                   Alumno.id.label("alumno_id"), Curso.nombre.label("curso"),
                                   Plantel.nombre.label("plantel")), *args)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    suma = db.scalar(_filtrar_mens(mens_stmt(func.coalesce(func.sum(Mensualidad.importe - Mensualidad.pagado), 0)), *args))
    rows = db.execute(stmt.order_by(Mensualidad.fecha_limite, Alumno.nombre_completo).limit(limit).offset(offset)).all()
    items = []
    for m, matricula, alumno, alumno_id, curso, plantel in rows:
        d = mens_dict(m, h, aviso)
        d.update(matricula=matricula, alumno=alumno, alumno_id=alumno_id, curso=curso, plantel=plantel)
        items.append(d)
    return {"total": total, "saldo": money(suma), "items": items}


# ---------------------------------------------------------------- tickets
@router.get("/tickets")
def listar_tickets(q: str | None = None, desde: date | None = None, hasta: date | None = None,
                   limit: int = Query(100, le=500), offset: int = 0,
                   user: Usuario = Depends(require("tickets.ver")), db: Session = Depends(get_db)):
    stmt = (select(Ticket, Pago.metodo, Pago.estado, Usuario.nombre)
            .join(Pago, Pago.id == Ticket.pago_id).outerjoin(Usuario, Usuario.id == Pago.usuario_id))
    if q:
        t = q.strip()
        cond = [Ticket.matricula.ilike(f"%{t.upper()}%"), Ticket.alumno.ilike(f"%{t}%")]
        if t.isdigit():
            cond.append(Ticket.numero == int(t))
        stmt = stmt.where(or_(*cond))
    if desde:
        stmt = stmt.where(Ticket.fecha >= desde)
    if hasta:
        stmt = stmt.where(Ticket.fecha <= hasta)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = db.execute(stmt.order_by(Ticket.numero.desc()).limit(limit).offset(offset)).all()
    items = [{
        "id": t.id, "numero": t.numero, "numero_texto": num_ticket(t.numero), "fecha": t.fecha,
        "alumno": t.alumno, "matricula": t.matricula, "curso": t.curso, "concepto": t.concepto,
        "importe": money(t.importe), "metodo": metodo, "estado": estado, "usuario": usuario,
        "plantel": t.plantel, "impresiones": t.impresiones,
    } for t, metodo, estado, usuario in rows]
    return {"total": total, "items": items}


def _ticket_o_404(db: Session, tid: int) -> Ticket:
    t = db.get(Ticket, tid)
    if not t:
        raise HTTPException(404, "Ticket no encontrado")
    return t


@router.get("/tickets/{tid}")
def ver_ticket(tid: int, user: Usuario = Depends(require("tickets.ver", "tickets.imprimir", "pagos.registrar")),
               db: Session = Depends(get_db)):
    t = _ticket_o_404(db, tid)
    return ticket_dict(t, formato=formato_ticket(db))


@router.get("/tickets/{tid}/pdf")
def pdf_ticket(tid: int, user: Usuario = Depends(require("tickets.ver", "tickets.imprimir", "pagos.registrar")),
               db: Session = Depends(get_db)):
    t = _ticket_o_404(db, tid)
    contenido = ticket_pdf(ticket_dict(t, formato=formato_ticket(db)))
    return Response(contenido, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="ticket-{num_ticket(t.numero)}.pdf"'})


@router.post("/tickets/{tid}/impresion")
def registrar_impresion(tid: int, user: Usuario = Depends(require("tickets.imprimir", "pagos.registrar")),
                        db: Session = Depends(get_db)):
    """Cuenta la impresión; a partir de la segunda se registra como reimpresión (mismo número)."""
    t = _ticket_o_404(db, tid)
    if t.impresiones > 0:
        log(db, user, "reimprimir_ticket", "ticket", t.id, f"Ticket {num_ticket(t.numero)} · {t.matricula}")
    t.impresiones += 1
    db.commit()
    return {"impresiones": t.impresiones, "numero": num_ticket(t.numero)}
