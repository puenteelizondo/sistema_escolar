from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Alumno, Asistencia, Curso, Inscripcion, Mensualidad, Usuario
from ..schemas import CursoIn, InscribirIn, MensualidadIn, MotivoIn
from ..security import get_current_user, require
from ..services import (
    alumno_dict, curso_dict, dias_aviso, estados_pago_alumnos, generar_mensualidades, inscribir, log,
    mens_dict, sync_estados,
)
from ..utils import hoy, money

router = APIRouter(tags=["cursos"])


def _scope(stmt, user: Usuario):
    if user.es_instructor:
        stmt = stmt.where(Curso.instructor_id == (user.instructor_id or -1))
    return stmt


def _curso_o_404(db: Session, cid: int, user: Usuario) -> Curso:
    c = db.scalar(_scope(select(Curso).where(Curso.id == cid).options(
        joinedload(Curso.plantel), joinedload(Curso.instructor)), user))
    if not c:
        raise HTTPException(404, "Curso no encontrado")
    return c


def _inscritos(db: Session, ids: list[int]) -> dict:
    if not ids:
        return {}
    return dict(db.execute(select(Inscripcion.curso_id, func.count()).where(
        Inscripcion.curso_id.in_(ids), Inscripcion.estado != "retirada").group_by(Inscripcion.curso_id)).all())


@router.get("/cursos")
def listar(q: str | None = None, estado: str | None = None, plantel_id: int | None = None,
           instructor_id: int | None = None, area: str | None = None,
           user: Usuario = Depends(require("cursos.ver")), db: Session = Depends(get_db)):
    sync_estados(db)
    stmt = _scope(select(Curso).options(joinedload(Curso.plantel), joinedload(Curso.instructor)), user)
    if q:
        stmt = stmt.where(or_(Curso.nombre.ilike(f"%{q}%"), Curso.codigo.ilike(f"%{q}%")))
    if estado:
        stmt = stmt.where(Curso.estado == estado)
    if plantel_id:
        stmt = stmt.where(Curso.plantel_id == plantel_id)
    if instructor_id:
        stmt = stmt.where(Curso.instructor_id == instructor_id)
    if area:
        stmt = stmt.where(Curso.area == area)
    cursos = db.scalars(stmt.order_by(Curso.fecha_inicio.desc(), Curso.nombre)).unique().all()
    n = _inscritos(db, [c.id for c in cursos])
    return [curso_dict(c, n.get(c.id, 0)) for c in cursos]


@router.post("/cursos", status_code=201)
def crear(data: CursoIn, user: Usuario = Depends(require("cursos.admin")), db: Session = Depends(get_db)):
    c = Curso(**data.model_dump())
    db.add(c)
    db.flush()
    log(db, user, "crear_curso", "curso", c.id, f"{c.codigo} {c.nombre}")
    db.commit()
    return curso_dict(_curso_o_404(db, c.id, user), 0)


@router.put("/cursos/{cid}")
def editar(cid: int, data: CursoIn, user: Usuario = Depends(require("cursos.admin")), db: Session = Depends(get_db)):
    c = _curso_o_404(db, cid, user)
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    log(db, user, "editar_curso", "curso", c.id, f"{c.codigo} {c.nombre}")
    db.commit()
    return curso_dict(_curso_o_404(db, cid, user), _inscritos(db, [cid]).get(cid, 0))


@router.post("/cursos/{cid}/cancelar")
def cancelar(cid: int, data: MotivoIn, user: Usuario = Depends(require("cursos.admin")), db: Session = Depends(get_db)):
    c = _curso_o_404(db, cid, user)
    c.estado = "cancelado"
    log(db, user, "cancelar_curso", "curso", c.id, f"{c.codigo} · {data.motivo or 'sin motivo'}")
    db.commit()
    return {"ok": True}


@router.delete("/cursos/{cid}")
def eliminar(cid: int, user: Usuario = Depends(require("cursos.admin")), db: Session = Depends(get_db)):
    c = _curso_o_404(db, cid, user)
    if db.scalar(select(func.count()).select_from(Inscripcion).where(Inscripcion.curso_id == cid)):
        raise HTTPException(409, "El curso ya tiene alumnos inscritos; no se puede eliminar. Cancélalo para conservar el historial")
    if db.scalar(select(func.count()).select_from(Asistencia).where(Asistencia.curso_id == cid)):
        raise HTTPException(409, "El curso tiene asistencias registradas; cancélalo en lugar de eliminarlo")
    log(db, user, "eliminar_curso", "curso", c.id, f"{c.codigo} {c.nombre}")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/cursos/{cid}")
def detalle(cid: int, user: Usuario = Depends(require("cursos.ver")), db: Session = Depends(get_db)):
    c = _curso_o_404(db, cid, user)
    inscs = db.scalars(select(Inscripcion).where(Inscripcion.curso_id == cid)
                       .options(joinedload(Inscripcion.alumno).joinedload(Alumno.plantel))
                       .order_by(Inscripcion.id)).unique().all()
    est = estados_pago_alumnos(db, [i.alumno_id for i in inscs])
    return {
        **curso_dict(c, sum(1 for i in inscs if i.estado != "retirada")),
        "alumnos": [{
            "inscripcion_id": i.id, "alumno_id": i.alumno_id, "matricula": i.alumno.matricula,
            "nombre_completo": i.alumno.nombre_completo, "telefono": i.alumno.telefono,
            "estado_inscripcion": i.estado, "estado_alumno": i.alumno.estado,
            "estado_pago": est.get(i.alumno_id, "sin_curso") if user.tiene("pagos.ver") else None,
            "fecha_inscripcion": i.fecha_inscripcion,
        } for i in inscs],
    }


# ---------------------------------------------------------------- inscripciones
@router.post("/cursos/{cid}/inscribir", status_code=201)
def inscribir_alumno(cid: int, data: InscribirIn, user: Usuario = Depends(require("inscripciones.admin")),
                     db: Session = Depends(get_db)):
    c = _curso_o_404(db, cid, user)
    if data.alumno_id:
        a = db.get(Alumno, data.alumno_id)
    elif data.matricula:
        a = db.scalar(select(Alumno).where(Alumno.matricula == data.matricula))
    else:
        raise HTTPException(400, "Indica la matrícula del alumno")
    if not a:
        raise HTTPException(404, "No existe un alumno con esa matrícula")
    insc = inscribir(db, user, a, c, data.fecha_inscripcion, data.generar_calendario)
    db.commit()
    return {"id": insc.id, "alumno": alumno_dict(a), "curso": c.nombre}


@router.post("/inscripciones/{iid}/retirar")
def retirar(iid: int, data: MotivoIn, user: Usuario = Depends(require("inscripciones.admin")),
            db: Session = Depends(get_db)):
    i = db.get(Inscripcion, iid)
    if not i:
        raise HTTPException(404, "Inscripción no encontrada")
    if i.estado == "retirada":
        raise HTTPException(409, "El alumno ya fue retirado de este curso")
    i.estado = "retirada"
    i.fecha_retiro = hoy()
    cancelados = 0
    for m in db.scalars(select(Mensualidad).where(Mensualidad.inscripcion_id == iid)):
        if Decimal_cero(m.pagado):  # sin pagos: se cancela el cargo
            m.cancelada = True
            cancelados += 1
    a = db.get(Alumno, i.alumno_id)
    log(db, user, "retirar_alumno_curso", "inscripcion", i.id,
        f"{a.matricula} · cargos cancelados: {cancelados} · {data.motivo or 'sin motivo'}")
    db.commit()
    return {"ok": True, "cargos_cancelados": cancelados}


def Decimal_cero(x) -> bool:
    return float(x or 0) == 0


@router.post("/inscripciones/{iid}/generar-calendario")
def generar_calendario(iid: int, user: Usuario = Depends(require("inscripciones.admin")), db: Session = Depends(get_db)):
    i = db.get(Inscripcion, iid)
    if not i:
        raise HTTPException(404, "Inscripción no encontrada")
    generar_mensualidades(db, i)
    log(db, user, "generar_calendario", "inscripcion", i.id)
    db.commit()
    return {"ok": True}


@router.put("/mensualidades/{mid}")
def editar_mensualidad(mid: int, data: MensualidadIn, user: Usuario = Depends(require("mensualidades.editar")),
                       db: Session = Depends(get_db)):
    m = db.scalar(select(Mensualidad).where(Mensualidad.id == mid).with_for_update())
    if not m:
        raise HTTPException(404, "Cargo no encontrado")
    antes = f"{m.fecha_limite} {money(m.importe)}"
    if data.importe is not None:
        if data.importe < m.pagado:
            raise HTTPException(400, "El importe no puede ser menor a lo ya pagado")
        m.importe = data.importe
    if data.fecha_limite:
        m.fecha_limite = data.fecha_limite
    insc = db.get(Inscripcion, m.inscripcion_id)
    a = db.get(Alumno, insc.alumno_id)
    log(db, user, "editar_mensualidad", "mensualidad", m.id,
        f"{a.matricula} {m.concepto} {m.numero}: {antes} -> {m.fecha_limite} {money(m.importe)}")
    db.commit()
    return mens_dict(m, hoy(), dias_aviso(db))
