from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Alumno, Asistencia, Curso, Inscripcion, Usuario
from ..schemas import AsistenciaIn
from ..security import require
from ..asistencia_excel import libro, logo_bytes
from ..services import cfg_get, log
from ..utils import hoy

router = APIRouter(tags=["asistencia"])

CLAVE = {"asistencia": "asistencias", "falta": "faltas", "retardo": "retardos", "justificada": "justificadas"}


def stats(estados: list[str]) -> dict:
    s = {"asistencias": 0, "faltas": 0, "retardos": 0, "justificadas": 0}
    for e in estados:
        s[CLAVE[e]] += 1
    total = sum(s.values())
    s["total"] = total
    # Retardos y faltas justificadas no penalizan: cuentan como presencia.
    s["porcentaje"] = round((s["asistencias"] + s["retardos"] + s["justificadas"]) * 100 / total, 1) if total else None
    return s


def _curso(db: Session, cid: int, user: Usuario) -> Curso:
    c = db.get(Curso, cid)
    if not c or (user.es_instructor and c.instructor_id != user.instructor_id):
        raise HTTPException(404, "Curso no encontrado")
    return c


@router.get("/asistencia/curso/{cid}")
def lista_curso(cid: int, fecha: date | None = None, user: Usuario = Depends(require("asistencia.ver", "asistencia.registrar")),
                db: Session = Depends(get_db)):
    c = _curso(db, cid, user)
    f = fecha or hoy()
    inscs = db.scalars(select(Inscripcion).where(Inscripcion.curso_id == cid, Inscripcion.estado != "retirada")
                       .options(joinedload(Inscripcion.alumno)).order_by(Inscripcion.id)).unique().all()
    registros = db.execute(select(Asistencia.inscripcion_id, Asistencia.fecha, Asistencia.estado)
                           .where(Asistencia.curso_id == cid)).all()
    por_insc: dict[int, list] = {}
    del_dia: dict[int, str] = {}
    for iid, fch, est in registros:
        por_insc.setdefault(iid, []).append(est)
        if fch == f:
            del_dia[iid] = est
    alumnos = [{
        "inscripcion_id": i.id, "alumno_id": i.alumno_id, "matricula": i.alumno.matricula,
        "nombre_completo": i.alumno.nombre_completo, "estado": del_dia.get(i.id),
        "stats": stats(por_insc.get(i.id, [])),
    } for i in inscs]
    return {"curso": {"id": c.id, "nombre": c.nombre, "codigo": c.codigo, "dias_clase": c.dias_clase,
                      "horario": c.horario}, "fecha": f, "guardada": bool(del_dia), "alumnos": alumnos}


@router.post("/asistencia/curso/{cid}")
def guardar(cid: int, data: AsistenciaIn, user: Usuario = Depends(require("asistencia.registrar")),
            db: Session = Depends(get_db)):
    c = _curso(db, cid, user)
    if data.fecha > hoy():
        raise HTTPException(400, "No se puede registrar asistencia en una fecha futura")
    validas = {i.id: i for i in db.scalars(select(Inscripcion).where(
        Inscripcion.curso_id == cid, Inscripcion.estado != "retirada"))}
    existentes = {a.inscripcion_id: a for a in db.scalars(select(Asistencia).where(
        Asistencia.curso_id == cid, Asistencia.fecha == data.fecha))}
    n = 0
    for r in data.registros:
        insc = validas.get(r.inscripcion_id)
        if not insc:
            raise HTTPException(400, "Una inscripción no pertenece a este curso")
        a = existentes.get(r.inscripcion_id)
        if a:
            a.estado, a.registrado_por = r.estado, user.id
        else:
            db.add(Asistencia(inscripcion_id=insc.id, alumno_id=insc.alumno_id, curso_id=cid,
                              fecha=data.fecha, estado=r.estado, registrado_por=user.id))
        n += 1
    log(db, user, "registrar_asistencia", "curso", cid, f"{c.codigo} · {data.fecha} · {n} alumnos")
    db.commit()
    return {"ok": True, "registrados": n}


@router.get("/asistencia/alumno/{matricula}")
def por_alumno(matricula: str, curso_id: int | None = None,
               user: Usuario = Depends(require("asistencia.ver")), db: Session = Depends(get_db)):
    a = db.scalar(select(Alumno).where(Alumno.matricula == matricula.strip().upper()))
    if not a:
        raise HTTPException(404, "No se encontró la matrícula")
    q = (select(Asistencia, Curso.nombre).join(Curso, Curso.id == Asistencia.curso_id)
         .where(Asistencia.alumno_id == a.id).order_by(Asistencia.fecha.desc()))
    if curso_id:
        q = q.where(Asistencia.curso_id == curso_id)
    if user.es_instructor:
        q = q.where(Curso.instructor_id == (user.instructor_id or -1))
    filas = db.execute(q).all()
    cursos: dict[int, dict] = {}
    for asis, nombre in filas:
        c = cursos.setdefault(asis.curso_id, {"curso_id": asis.curso_id, "curso": nombre, "estados": [], "registros": []})
        c["estados"].append(asis.estado)
        c["registros"].append({"fecha": asis.fecha, "estado": asis.estado})
    return {
        "alumno": {"id": a.id, "matricula": a.matricula, "nombre_completo": a.nombre_completo},
        "cursos": [{"curso_id": c["curso_id"], "curso": c["curso"], **stats(c["estados"]),
                    "registros": c["registros"]} for c in cursos.values()],
    }


@router.get("/asistencia/exportar")
def exportar(curso_id: int | None = None, desde: date | None = None, hasta: date | None = None,
             user: Usuario = Depends(require("asistencia.ver", "asistencia.registrar")), db: Session = Depends(get_db)):
    """Excel con una hoja por curso. El instructor recibe solo sus cursos; el administrador, todos."""
    if curso_id:
        cursos = [_curso(db, curso_id, user)]
    else:
        q = select(Curso).where(Curso.estado != "cancelado").options(joinedload(Curso.instructor), joinedload(Curso.plantel))
        if user.es_instructor:
            q = q.where(Curso.instructor_id == (user.instructor_id or -1))
        cursos = list(db.scalars(q.order_by(Curso.nombre)).unique().all())
    if not cursos:
        raise HTTPException(404, "No hay cursos para exportar")
    datos = []
    for c in cursos:
        inscs = db.scalars(select(Inscripcion).where(Inscripcion.curso_id == c.id)
                           .options(joinedload(Inscripcion.alumno)).order_by(Inscripcion.id)).unique().all()
        filtro = [Asistencia.curso_id == c.id]
        if desde:
            filtro.append(Asistencia.fecha >= desde)
        if hasta:
            filtro.append(Asistencia.fecha <= hasta)
        regs = db.execute(select(Asistencia.inscripcion_id, Asistencia.fecha, Asistencia.estado).where(*filtro)).all()
        por_insc: dict[int, dict] = {}
        fechas = set()
        for iid, f, est in regs:
            por_insc.setdefault(iid, {})[f] = est
            fechas.add(f)
        alumnos = [{"matricula": i.alumno.matricula, "nombre": i.alumno.nombre_completo,
                    "retirado": i.estado == "retirada", "reg": por_insc.get(i.id, {})}
                   for i in inscs if i.estado != "retirada" or i.id in por_insc]
        datos.append({"curso": {"nombre": c.nombre, "codigo": c.codigo, "dias_clase": c.dias_clase, "horario": c.horario,
                                "instructor": c.instructor.nombre if c.instructor else None,
                                "plantel": c.plantel.nombre if c.plantel else None},
                      "alumnos": alumnos, "fechas": sorted(fechas)})
    if desde or hasta:
        rango = f"{desde.strftime('%d/%m/%Y') if desde else 'inicio'} al {hasta.strftime('%d/%m/%Y') if hasta else 'hoy'}"
    else:
        rango = "Todas las clases registradas (a " + hoy().strftime("%d/%m/%Y") + ")"
    contenido = libro(cfg_get(db, "escuela_nombre"), datos, rango, logo_bytes(cfg_get(db, "logo")))
    nombre = f"asistencia-{cursos[0].codigo if len(cursos) == 1 else 'cursos'}-{hoy().isoformat()}.xlsx"
    log(db, user, "exportar_asistencia", "curso", curso_id, f"{len(cursos)} curso(s)")
    db.commit()
    return Response(contenido, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}"'})
