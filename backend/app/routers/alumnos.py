import base64

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Alumno, Asistencia, Curso, Inscripcion, Log, Pago, Ticket, Usuario
from ..schemas import AlumnoIn, FotoIn, MotivoIn
from ..security import require
from ..services import (
    alumno_dict, estados_pago_alumnos, log, resumen_cobro, siguiente_matricula,
    usar_matricula_auto, pago_row_dict, pagos_stmt, PAGO_COLS,
)
from ..utils import hoy

router = APIRouter(tags=["alumnos"])


def _norm_nombre(d: AlumnoIn) -> str:
    return " ".join(x for x in (d.nombre, d.apellido_paterno, d.apellido_materno) if x)


def _alumnos_visibles(stmt, user: Usuario):
    """Un instructor solo ve alumnos inscritos en sus cursos."""
    if user.es_instructor:
        if not user.instructor_id:
            return stmt.where(False)
        sub = (select(Inscripcion.alumno_id).join(Curso, Curso.id == Inscripcion.curso_id)
               .where(Curso.instructor_id == user.instructor_id))
        stmt = stmt.where(Alumno.id.in_(sub))
    return stmt


def _alumno_o_404(db: Session, aid: int, user: Usuario) -> Alumno:
    a = db.scalar(_alumnos_visibles(select(Alumno).where(Alumno.id == aid).options(joinedload(Alumno.plantel)), user))
    if not a:
        raise HTTPException(404, "Alumno no encontrado")
    return a


@router.get("/alumnos")
def listar(q: str | None = None, estado: str | None = None, plantel_id: int | None = None,
           curso_id: int | None = None, pago: str | None = None,
           limit: int = Query(50, le=200), offset: int = 0,
           user: Usuario = Depends(require("alumnos.ver")), db: Session = Depends(get_db)):
    stmt = select(Alumno).options(joinedload(Alumno.plantel))
    stmt = _alumnos_visibles(stmt, user)
    if q:
        t = q.strip()
        stmt = stmt.where(or_(Alumno.matricula.ilike(f"%{t.upper()}%"), Alumno.nombre_completo.ilike(f"%{t}%"),
                              Alumno.telefono.ilike(f"%{t}%"), Alumno.whatsapp.ilike(f"%{t}%"),
                              Alumno.id.in_(select(Inscripcion.alumno_id).join(Curso).where(
                                  or_(Curso.nombre.ilike(f"%{t}%"), Curso.codigo.ilike(f"%{t}%"))))))
    if estado:
        stmt = stmt.where(Alumno.estado == estado)
    if plantel_id:
        stmt = stmt.where(Alumno.plantel_id == plantel_id)
    if curso_id:
        stmt = stmt.where(Alumno.id.in_(select(Inscripcion.alumno_id).where(
            Inscripcion.curso_id == curso_id, Inscripcion.estado != "retirada")))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    exacta = case((Alumno.matricula == (q or "").strip().upper(), 0), else_=1)
    rows = db.scalars(stmt.order_by(exacta, Alumno.nombre_completo).limit(limit).offset(offset)).unique().all()
    ids = [a.id for a in rows]
    est = estados_pago_alumnos(db, ids)
    # curso activo de cada alumno
    cursos = {}
    if ids:
        for aid, nombre in db.execute(
            select(Inscripcion.alumno_id, Curso.nombre).join(Curso, Curso.id == Inscripcion.curso_id)
            .where(Inscripcion.alumno_id.in_(ids), Inscripcion.estado == "activa")
            .order_by(Inscripcion.fecha_inicio)
        ).all():
            cursos.setdefault(aid, []).append(nombre)
    # fotos: solo se consulta el tamaño (sirve de versión para el caché); la imagen va por /alumnos/{id}/foto
    fotos = {}
    if ids:
        fotos = dict(db.execute(select(Alumno.id, func.length(Alumno.foto)).where(
            Alumno.id.in_(ids), Alumno.foto.is_not(None))).all())
    out = []
    for a in rows:
        d = alumno_dict(a)
        d["foto_url"] = f"/api/alumnos/{a.id}/foto?v={fotos[a.id]}" if a.id in fotos else None
        d["estado_pago"] = est.get(a.id, "sin_curso")
        d["cursos_activos"] = cursos.get(a.id, [])
        out.append(d)
    if pago:
        out = [d for d in out if d["estado_pago"] == pago]
    return {"total": total, "items": out}


@router.get("/alumnos/buscar")
def autocompletar(q: str, user: Usuario = Depends(require("alumnos.ver", "pagos.registrar")),
                  db: Session = Depends(get_db)):
    """Sugerencias rápidas mientras se escribe (matrícula o nombre)."""
    t = q.strip()
    if len(t) < 2:
        return []
    stmt = _alumnos_visibles(select(Alumno), user).where(
        or_(Alumno.matricula.ilike(f"{t.upper()}%"), Alumno.nombre_completo.ilike(f"%{t}%"),
            Alumno.matricula.ilike(f"%{t.upper()}%"))
    ).order_by(Alumno.matricula).limit(8)
    return [{"id": a.id, "matricula": a.matricula, "nombre_completo": a.nombre_completo, "estado": a.estado}
            for a in db.scalars(stmt)]


@router.get("/alumnos/siguiente-matricula")
def preview_matricula(user: Usuario = Depends(require("alumnos.crear")), db: Session = Depends(get_db)):
    return {"matricula": siguiente_matricula(db)}


@router.post("/alumnos", status_code=201)
def crear(data: AlumnoIn, user: Usuario = Depends(require("alumnos.crear")), db: Session = Depends(get_db)):
    matricula = data.matricula or siguiente_matricula(db)
    previo = db.scalar(select(Alumno).where(Alumno.matricula == matricula))
    if previo:
        raise HTTPException(409, f"La matrícula {matricula} ya pertenece a {previo.nombre_completo}")
    a = Alumno(
        matricula=matricula, nombre=data.nombre, apellido_paterno=data.apellido_paterno,
        apellido_materno=data.apellido_materno, nombre_completo=_norm_nombre(data), foto=data.foto,
        fecha_nacimiento=data.fecha_nacimiento, telefono=data.telefono, whatsapp=data.whatsapp,
        correo=data.correo, direccion=data.direccion, contacto_emergencia=data.contacto_emergencia,
        telefono_emergencia=data.telefono_emergencia, plantel_id=data.plantel_id,
        fecha_inscripcion=data.fecha_inscripcion or hoy(), estado="activo", creado_por=user.id,
    )
    db.add(a)
    db.flush()
    usar_matricula_auto(db, matricula)
    log(db, user, "crear_alumno", "alumno", a.id, f"{a.matricula} {a.nombre_completo}")
    db.commit()
    db.refresh(a)
    return alumno_dict(a, foto=True)


@router.get("/alumnos/{aid}")
def ver(aid: int, user: Usuario = Depends(require("alumnos.ver")), db: Session = Depends(get_db)):
    return alumno_dict(_alumno_o_404(db, aid, user), foto=True)


@router.get("/alumnos/{aid}/foto")
def ver_foto(aid: int, user: Usuario = Depends(require("alumnos.ver")), db: Session = Depends(get_db)):
    """Imagen binaria del alumno (se cachea en el navegador; la URL lleva ?v= para renovarla al cambiar)."""
    _alumno_o_404(db, aid, user)
    foto = db.scalar(select(Alumno.foto).where(Alumno.id == aid))
    if not foto or "," not in foto:
        raise HTTPException(404, "Sin foto")
    cab, datos = foto.split(",", 1)
    tipo = cab[5:].split(";")[0] or "image/jpeg"
    return Response(base64.b64decode(datos), media_type=tipo,
                    headers={"Cache-Control": "private, max-age=86400"})


@router.put("/alumnos/{aid}/foto")
def cambiar_foto(aid: int, data: FotoIn, user: Usuario = Depends(require("alumnos.editar")),
                 db: Session = Depends(get_db)):
    """Pone, cambia o quita (foto = null) la fotografía sin tocar el resto de los datos."""
    a = _alumno_o_404(db, aid, user)
    a.foto = data.foto
    log(db, user, "foto_alumno" if data.foto else "quitar_foto_alumno", "alumno", a.id, a.matricula)
    db.commit()
    return {"ok": True}


@router.put("/alumnos/{aid}")
def editar(aid: int, data: AlumnoIn, user: Usuario = Depends(require("alumnos.editar")),
           db: Session = Depends(get_db)):
    a = _alumno_o_404(db, aid, user)
    if data.matricula and data.matricula != a.matricula:
        if db.scalar(select(Alumno.id).where(Alumno.matricula == data.matricula, Alumno.id != aid)):
            raise HTTPException(409, f"La matrícula {data.matricula} ya está en uso")
        log(db, user, "cambiar_matricula", "alumno", a.id, f"{a.matricula} -> {data.matricula}")
        a.matricula = data.matricula
    for k in ("nombre", "apellido_paterno", "apellido_materno", "fecha_nacimiento", "telefono", "whatsapp",
              "correo", "direccion", "contacto_emergencia", "telefono_emergencia", "plantel_id"):
        setattr(a, k, getattr(data, k))
    if data.foto is not None:
        a.foto = data.foto
    if data.fecha_inscripcion:
        a.fecha_inscripcion = data.fecha_inscripcion
    if data.estado and data.estado != a.estado:
        log(db, user, "cambiar_estado_alumno", "alumno", a.id, f"{a.estado} -> {data.estado}")
        a.estado = data.estado
    a.nombre_completo = _norm_nombre(data)
    log(db, user, "editar_alumno", "alumno", a.id, f"{a.matricula} {a.nombre_completo}")
    db.commit()
    db.refresh(a)
    return alumno_dict(a, foto=True)


@router.post("/alumnos/{aid}/baja")
def baja(aid: int, data: MotivoIn, user: Usuario = Depends(require("alumnos.baja")), db: Session = Depends(get_db)):
    a = _alumno_o_404(db, aid, user)
    if a.estado == "baja":
        raise HTTPException(409, "El alumno ya está dado de baja")
    a.estado = "baja"
    log(db, user, "baja_alumno", "alumno", a.id, f"{a.matricula} · {data.motivo or 'sin motivo'}")
    db.commit()
    return {"ok": True}


@router.post("/alumnos/{aid}/reactivar")
def reactivar(aid: int, user: Usuario = Depends(require("alumnos.baja")), db: Session = Depends(get_db)):
    a = _alumno_o_404(db, aid, user)
    a.estado = "activo"
    log(db, user, "reactivar_alumno", "alumno", a.id, a.matricula)
    db.commit()
    return {"ok": True}


def _stats_asistencia(db: Session, alumno_id: int) -> dict:
    """{curso_id: {asistencias, faltas, retardos, justificadas, total, porcentaje}}"""
    filas = db.execute(
        select(Asistencia.curso_id, Asistencia.estado, func.count()).where(Asistencia.alumno_id == alumno_id)
        .group_by(Asistencia.curso_id, Asistencia.estado)
    ).all()
    out = {}
    for cid, est, n in filas:
        s = out.setdefault(cid, {"asistencias": 0, "faltas": 0, "retardos": 0, "justificadas": 0})
        s[{"asistencia": "asistencias", "falta": "faltas", "retardo": "retardos", "justificada": "justificadas"}[est]] = n
    for s in out.values():
        total = sum(s.values())
        s["total"] = total
        s["porcentaje"] = round((s["asistencias"] + s["retardos"] + s["justificadas"]) * 100 / total, 1) if total else None
    return out


@router.get("/alumnos/{aid}/expediente")
def expediente(aid: int, user: Usuario = Depends(require("alumnos.ver")), db: Session = Depends(get_db)):
    a = _alumno_o_404(db, aid, user)
    resumen = resumen_cobro(db, a)
    stats = _stats_asistencia(db, a.id)
    for i in resumen["inscripciones"]:
        i["asistencia"] = stats.get(i["curso_id"])
    pagos = []
    if user.tiene("pagos.ver"):
        stmt = pagos_stmt(*PAGO_COLS()).where(Alumno.id == a.id).order_by(Pago.fecha.desc(), Pago.id.desc())
        pagos = [pago_row_dict(r) for r in db.execute(stmt).all()]
    else:
        # Sin permiso de pagos (p. ej. instructor): ni adeudos, ni costos, ni calendario de cobros.
        resumen["pendientes"] = []
        resumen.update(proximo_pago=None, ultimo_pago=None, saldo_pendiente=0, saldo_total=0, estado_pago=None)
        for i in resumen["inscripciones"]:
            i.update(mensualidades=[], costo_inscripcion=None, mensualidad=None, saldo_total=0)
        resumen["curso_actual"] = None
    bitacora = []
    if user.tiene("bitacora.ver"):
        bitacora = [{"fecha": l.fecha, "usuario": l.usuario, "accion": l.accion, "detalle": l.detalle}
                    for l in db.scalars(select(Log).where(Log.entidad == "alumno", Log.entidad_id == a.id)
                                        .order_by(Log.fecha.desc()).limit(50))]
    return {**resumen, "pagos": pagos, "bitacora": bitacora}
