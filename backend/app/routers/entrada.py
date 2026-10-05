"""Lector de credenciales en la entrada del plantel: la credencial (código de barras, QR o RFID que
"teclea" la matrícula) registra la asistencia del alumno en el curso que le toca a esta hora."""
import re
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Alumno, Asistencia, Curso, Inscripcion, Usuario
from ..security import require
from ..services import cfg_get
from ..utils import ahora, hoy

router = APIRouter(tags=["entrada"])

LETRAS = ["L", "M", "X", "J", "V", "S", "D"]
HORARIO = re.compile(r"(\d{1,2}):(\d{2})\s*(?:-|–|a|a\s+las)\s*(\d{1,2}):(\d{2})")


class EscaneoIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=60)
    curso_id: int | None = None


def _horas(horario: str | None) -> tuple[time, time]:
    """'18:00 - 21:00' -> (18:00, 21:00). Sin horario válido se considera todo el día."""
    m = HORARIO.search(horario or "")
    if not m:
        return time(0, 0), time(23, 59)
    h1, m1, h2, m2 = (int(x) for x in m.groups())
    try:
        return time(h1, m1), time(h2, m2)
    except ValueError:
        return time(0, 0), time(23, 59)


def _opcion(c: Curso) -> dict:
    return {"curso_id": c.id, "nombre": c.nombre, "horario": c.horario}


def _resp(resultado: str, mensaje: str, alumno: Alumno | None = None, curso: Curso | None = None, **extra) -> dict:
    out = {"resultado": resultado, "mensaje": mensaje, "hora": ahora().strftime("%H:%M")}
    if alumno:
        out["alumno"] = {"matricula": alumno.matricula, "nombre": alumno.nombre_completo, "foto": alumno.foto}
    if curso:
        out["curso"] = _opcion(curso)
    out.update(extra)
    return out


@router.post("/entrada/escaneo")
def escaneo(data: EscaneoIn, user: Usuario = Depends(require("asistencia.escanear")), db: Session = Depends(get_db)):
    codigo = re.sub(r"\s+", "", data.codigo).upper()
    alumno = db.scalar(select(Alumno).where(Alumno.matricula == codigo))
    if not alumno:
        return _resp("no_encontrado", "Credencial no reconocida. Avisa en recepción.")
    if alumno.estado == "baja":
        return _resp("baja", "Este alumno está dado de baja. Pasa a recepción.", alumno)

    ahora_dt = ahora()
    hoy_d, ahora_t = ahora_dt.date(), ahora_dt.time()
    letra = LETRAS[hoy_d.weekday()]
    antes = int(cfg_get(db, "entrada_antes_min") or 60)
    tolerancia = int(cfg_get(db, "entrada_tolerancia_min") or 10)

    inscs = db.scalars(select(Inscripcion).where(Inscripcion.alumno_id == alumno.id, Inscripcion.estado == "activa")
                       .options(joinedload(Inscripcion.curso))).unique().all()
    de_hoy = []  # (inscripcion, curso, inicio, fin)
    for i in inscs:
        c = i.curso
        if c.estado in ("cancelado", "terminado") or not (c.fecha_inicio <= hoy_d <= c.fecha_fin):
            continue
        if letra not in (c.dias_clase or "").split(","):
            continue
        ini, fin = _horas(c.horario)
        de_hoy.append((i, c, ini, fin))

    if not inscs:
        return _resp("sin_clase", "No tienes un curso activo. Pasa a recepción.", alumno)
    if not de_hoy:
        return _resp("sin_clase", "Hoy no tienes clase.", alumno)

    ahora_n = ahora_dt.replace(tzinfo=None)

    def en_horario(x):
        _, _, ini, fin = x
        return datetime.combine(hoy_d, ini) - timedelta(minutes=antes) <= ahora_n <= datetime.combine(hoy_d, fin)

    if data.curso_id:
        elegido = next((x for x in de_hoy if x[1].id == data.curso_id), None)
        if not elegido:
            return _resp("sin_clase", "Ese curso no tiene clase hoy.", alumno)
    else:
        posibles = [x for x in de_hoy if en_horario(x)]
        if len(posibles) > 1:
            return _resp("elegir", "¿A qué clase vas a entrar?", alumno, opciones=[_opcion(x[1]) for x in posibles])
        if len(posibles) == 1:
            elegido = posibles[0]
        else:
            horarios = " · ".join(f"{x[1].nombre} {x[1].horario or ''}".strip() for x in de_hoy)
            futuras = [x for x in de_hoy if ahora_t < x[2]]
            msg = (f"Aún no es hora de tu clase ({futuras[0][1].horario}). Vuelve más tarde." if futuras
                   else "Tu clase de hoy ya terminó.")
            return _resp("sin_clase", msg, alumno, detalle=horarios)

    insc, curso, ini, fin = elegido
    previa = db.scalar(select(Asistencia).where(Asistencia.inscripcion_id == insc.id, Asistencia.fecha == hoy_d))
    if previa and previa.estado != "falta":
        etiqueta = {"asistencia": "Asistencia", "retardo": "Retardo", "justificada": "Falta justificada"}[previa.estado]
        return _resp("ya_registrada", f"Ya estaba registrada tu entrada de hoy ({etiqueta.lower()}).", alumno, curso,
                     estado=previa.estado)

    limite = (datetime.combine(hoy_d, ini) + timedelta(minutes=tolerancia)).time()
    estado = "retardo" if ahora_t > limite and ini != time(0, 0) else "asistencia"
    if previa:
        previa.estado, previa.registrado_por = estado, user.id
    else:
        db.add(Asistencia(inscripcion_id=insc.id, alumno_id=alumno.id, curso_id=curso.id, fecha=hoy_d,
                          estado=estado, registrado_por=user.id))
    db.commit()
    return _resp("retardo" if estado == "retardo" else "ok",
                 "Llegaste con retardo. Asistencia registrada." if estado == "retardo" else "¡Asistencia registrada!",
                 alumno, curso, estado=estado)
