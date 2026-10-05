from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Curso, Instructor, Plantel, Usuario
from ..schemas import InstructorIn, PlantelIn
from ..security import get_current_user, require
from ..services import log

router = APIRouter(tags=["catalogos"])


def plantel_dict(p: Plantel, cursos: int = 0) -> dict:
    return {"id": p.id, "nombre": p.nombre, "direccion": p.direccion, "telefono": p.telefono,
            "responsable": p.responsable, "activo": p.activo, "cursos": cursos}


def instructor_dict(i: Instructor, cursos: int = 0) -> dict:
    return {"id": i.id, "nombre": i.nombre, "telefono": i.telefono, "whatsapp": i.whatsapp,
            "correo": i.correo, "especialidad": i.especialidad, "activo": i.activo, "cursos": cursos}


@router.get("/planteles")
def listar_planteles(user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    conteo = dict(db.execute(select(Curso.plantel_id, func.count()).group_by(Curso.plantel_id)).all())
    return [plantel_dict(p, conteo.get(p.id, 0)) for p in db.scalars(select(Plantel).order_by(Plantel.nombre))]


@router.post("/planteles", status_code=201)
def crear_plantel(data: PlantelIn, user: Usuario = Depends(require("catalogos.admin")), db: Session = Depends(get_db)):
    if db.scalar(select(Plantel.id).where(func.lower(Plantel.nombre) == data.nombre.lower())):
        raise HTTPException(409, "Ya existe un plantel con ese nombre")
    p = Plantel(**data.model_dump())
    db.add(p)
    db.flush()
    log(db, user, "crear_plantel", "plantel", p.id, p.nombre)
    db.commit()
    return plantel_dict(p)


@router.put("/planteles/{pid}")
def editar_plantel(pid: int, data: PlantelIn, user: Usuario = Depends(require("catalogos.admin")),
                   db: Session = Depends(get_db)):
    p = db.get(Plantel, pid)
    if not p:
        raise HTTPException(404, "Plantel no encontrado")
    if db.scalar(select(Plantel.id).where(func.lower(Plantel.nombre) == data.nombre.lower(), Plantel.id != pid)):
        raise HTTPException(409, "Ya existe un plantel con ese nombre")
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    log(db, user, "editar_plantel", "plantel", p.id, p.nombre)
    db.commit()
    return plantel_dict(p)


@router.get("/instructores")
def listar_instructores(user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    conteo = dict(db.execute(select(Curso.instructor_id, func.count()).group_by(Curso.instructor_id)).all())
    return [instructor_dict(i, conteo.get(i.id, 0))
            for i in db.scalars(select(Instructor).order_by(Instructor.nombre))]


@router.post("/instructores", status_code=201)
def crear_instructor(data: InstructorIn, user: Usuario = Depends(require("catalogos.admin")),
                     db: Session = Depends(get_db)):
    i = Instructor(**data.model_dump())
    db.add(i)
    db.flush()
    log(db, user, "crear_instructor", "instructor", i.id, i.nombre)
    db.commit()
    return instructor_dict(i)


@router.put("/instructores/{iid}")
def editar_instructor(iid: int, data: InstructorIn, user: Usuario = Depends(require("catalogos.admin")),
                      db: Session = Depends(get_db)):
    i = db.get(Instructor, iid)
    if not i:
        raise HTTPException(404, "Instructor no encontrado")
    for k, v in data.model_dump().items():
        setattr(i, k, v)
    log(db, user, "editar_instructor", "instructor", i.id, i.nombre)
    db.commit()
    return instructor_dict(i)
