import json
import os
import re
import subprocess
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from ..config import BACKUP_DIR, DATABASE_URL
from ..db import get_db
from ..models import Log, Ticket, Usuario
from ..security import require
from ..services import DEFAULT_CONFIG, cfg_all, cfg_get, cfg_set, log
from ..utils import ahora, dt_local

router = APIRouter(tags=["admin"])

CLAVES_EDITABLES = set(DEFAULT_CONFIG.keys()) - {"ultimo_respaldo"}


@router.get("/config/publica")
def config_publica(db: Session = Depends(get_db)):
    """Datos que necesita la pantalla de login (sin sesión)."""
    return {"escuela_nombre": cfg_get(db, "escuela_nombre"), "logo": cfg_get(db, "logo")}


@router.get("/config")
def ver_config(user: Usuario = Depends(require("config.admin")), db: Session = Depends(get_db)):
    c = cfg_all(db)
    c["metodos_pago"] = json.loads(c["metodos_pago"])
    ultimo = db.scalar(select(func.max(Ticket.numero)))
    return {"config": c, "ultimo_ticket": ultimo or 0}


@router.put("/config")
def guardar_config(data: dict, user: Usuario = Depends(require("config.admin")), db: Session = Depends(get_db)):
    cambios = []
    for clave, valor in data.items():
        if clave not in CLAVES_EDITABLES:
            continue
        if clave == "metodos_pago":
            lista = [str(x).strip() for x in (valor if isinstance(valor, list) else str(valor).split(",")) if str(x).strip()]
            if not lista:
                raise HTTPException(400, "Debe existir al menos un método de pago")
            valor = json.dumps(lista, ensure_ascii=False)
        elif clave == "ticket_ancho":
            if str(valor) not in ("58", "80", "carta"):
                raise HTTPException(400, "Ancho de ticket no válido")
            valor = str(valor)
        elif clave in ("ticket_mostrar_logo", "ticket_mostrar_concepto"):
            valor = "true" if valor in (True, "true", "True", 1, "1") else "false"
        elif clave == "ticket_siguiente":
            try:
                n = int(valor)
            except (TypeError, ValueError):
                raise HTTPException(400, "El número de ticket debe ser numérico")
            ultimo = db.scalar(select(func.max(Ticket.numero))) or 0
            actual = int(cfg_get(db, "ticket_siguiente") or 1)
            if n < 1:
                raise HTTPException(400, "El número inicial debe ser mayor a cero")
            if n <= ultimo and n != actual:
                raise HTTPException(400, f"El siguiente ticket debe ser mayor al último emitido ({ultimo:04d})")
            valor = str(n)
        elif clave == "matricula_siguiente":
            try:
                valor = str(max(1, int(valor)))
            except (TypeError, ValueError):
                raise HTTPException(400, "El número de matrícula debe ser numérico")
        elif clave == "matricula_prefijo":
            valor = re.sub(r"[^A-Za-z0-9]", "", str(valor or "")).upper()[:6]
        elif clave == "dias_aviso":
            try:
                valor = str(min(60, max(0, int(valor))))
            except (TypeError, ValueError):
                raise HTTPException(400, "Los días de aviso deben ser un número")
        elif clave == "logo":
            valor = valor or ""
            if valor and (not re.match(r"^data:image/(png|jpeg);base64,", valor) or len(valor) > 900_000):
                raise HTTPException(400, "El logo debe ser PNG o JPG de menos de 600 KB")
        else:
            valor = str(valor if valor is not None else "").strip()[:2000]
        if cfg_get(db, clave) != valor:
            cfg_set(db, clave, valor)
            cambios.append(clave)
    if cambios:
        log(db, user, "cambiar_configuracion", "configuracion", None, ", ".join(cambios))
    db.commit()
    return {"ok": True, "cambios": cambios}


# ---------------------------------------------------------------- respaldos
NOMBRE_RE = re.compile(r"^respaldo-\d{8}-\d{6}\.dump$")


def _lista_respaldos():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    out = []
    for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if NOMBRE_RE.match(f):
            st = os.stat(os.path.join(BACKUP_DIR, f))
            out.append({"nombre": f, "tamano": st.st_size,
                        "fecha": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat()})
    return out


@router.get("/respaldos")
def listar_respaldos(user: Usuario = Depends(require("respaldos.admin")), db: Session = Depends(get_db)):
    return {"items": _lista_respaldos(), "ultimo": cfg_get(db, "ultimo_respaldo") or None}


@router.post("/respaldos", status_code=201)
def crear_respaldo(user: Usuario = Depends(require("respaldos.admin")), db: Session = Depends(get_db)):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    nombre = f"respaldo-{ahora().strftime('%Y%m%d-%H%M%S')}.dump"
    destino = os.path.join(BACKUP_DIR, nombre)
    u = make_url(DATABASE_URL)
    env = {**os.environ, "PGPASSWORD": u.password or ""}
    cmd = ["pg_dump", "-h", u.host or "localhost", "-p", str(u.port or 5432), "-U", u.username,
           "-d", u.database, "-F", "c", "-f", destino]
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        raise HTTPException(500, "pg_dump no está instalado en el servidor")
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "El respaldo tardó demasiado")
    if r.returncode != 0:
        if os.path.exists(destino):
            os.remove(destino)
        raise HTTPException(500, f"No se pudo crear el respaldo: {r.stderr.strip()[:300]}")
    cfg_set(db, "ultimo_respaldo", ahora().isoformat())
    log(db, user, "crear_respaldo", "respaldo", None, nombre)
    db.commit()
    return {"nombre": nombre, "tamano": os.path.getsize(destino)}


@router.get("/respaldos/{nombre}")
def descargar_respaldo(nombre: str, user: Usuario = Depends(require("respaldos.admin")), db: Session = Depends(get_db)):
    if not NOMBRE_RE.match(nombre) or not os.path.exists(os.path.join(BACKUP_DIR, nombre)):
        raise HTTPException(404, "Respaldo no encontrado")
    log(db, user, "descargar_respaldo", "respaldo", None, nombre)
    db.commit()
    return FileResponse(os.path.join(BACKUP_DIR, nombre), filename=nombre, media_type="application/octet-stream")


# ---------------------------------------------------------------- bitácora
@router.get("/bitacora")
def bitacora(q: str | None = None, accion: str | None = None, usuario: str | None = None,
             desde: date | None = None, hasta: date | None = None, limit: int = 200, offset: int = 0,
             user: Usuario = Depends(require("bitacora.ver")), db: Session = Depends(get_db)):
    stmt = select(Log)
    if q:
        stmt = stmt.where(or_(Log.detalle.ilike(f"%{q}%"), Log.accion.ilike(f"%{q}%")))
    if accion:
        stmt = stmt.where(Log.accion == accion)
    if usuario:
        stmt = stmt.where(Log.usuario == usuario)
    if desde:
        stmt = stmt.where(Log.fecha >= datetime.combine(desde, datetime.min.time()).astimezone())
    if hasta:
        stmt = stmt.where(Log.fecha < datetime.combine(hasta + timedelta(days=1), datetime.min.time()).astimezone())
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Log.fecha.desc(), Log.id.desc()).limit(min(limit, 500)).offset(offset)).all()
    acciones = [a for (a,) in db.execute(select(Log.accion).distinct().order_by(Log.accion))]
    return {"total": total, "acciones": acciones, "items": [
        {"id": l.id, "fecha": dt_local(l.fecha), "usuario": l.usuario, "accion": l.accion,
         "entidad": l.entidad, "entidad_id": l.entidad_id, "detalle": l.detalle} for l in rows]}
