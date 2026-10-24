"""Respaldo completo en un solo archivo (JSON comprimido) y restauración.

No depende de pg_dump ni de la versión de PostgreSQL: funciona igual en la PC (Docker) y en Render.
El archivo trae TODAS las tablas: alumnos (con fotos), cursos, pagos, tickets, asistencia, usuarios,
configuración y bitácora. Restaurar reemplaza todo lo que haya en la base, en una sola transacción:
si algo falla no se cambia nada.
"""
import gzip
import json
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .models import Base
from .utils import ahora

FORMATO = "sistema-escolar-respaldo"
VERSION = 1
MAX_BYTES = 300 * 1024 * 1024  # 300 MB descomprimido


def _json(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    raise TypeError(f"No se puede guardar {type(v).__name__}")


def exportar(db: Session, escuela: str | None = None) -> bytes:
    tablas, conteos = {}, {}
    for t in Base.metadata.sorted_tables:
        orden = [c for c in t.primary_key.columns] or list(t.columns)[:1]
        filas = [dict(r._mapping) for r in db.execute(select(t).order_by(*orden))]
        tablas[t.name] = filas
        conteos[t.name] = len(filas)
    doc = {"formato": FORMATO, "version": VERSION, "fecha": ahora().isoformat(), "escuela": escuela,
           "conteos": conteos, "tablas": tablas}
    crudo = json.dumps(doc, default=_json, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return gzip.compress(crudo, compresslevel=6)


def leer(contenido: bytes) -> dict:
    """Valida y abre el archivo. Lanza ValueError con un mensaje claro si no sirve."""
    if not contenido:
        raise ValueError("El archivo está vacío")
    try:
        crudo = gzip.decompress(contenido) if contenido[:2] == b"\x1f\x8b" else contenido
    except (OSError, EOFError):
        raise ValueError("El archivo está dañado o incompleto")
    if len(crudo) > MAX_BYTES:
        raise ValueError("El archivo es demasiado grande")
    try:
        doc = json.loads(crudo.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("Este archivo no es un respaldo del sistema")
    if not isinstance(doc, dict) or doc.get("formato") != FORMATO or not isinstance(doc.get("tablas"), dict):
        raise ValueError("Este archivo no es un respaldo del sistema")
    if int(doc.get("version") or 0) > VERSION:
        raise ValueError("El respaldo es de una versión más nueva del sistema; actualiza primero el sistema")
    tablas = {t.name for t in Base.metadata.sorted_tables}
    if not {"usuarios", "roles", "alumnos"} <= set(doc["tablas"]) or not set(doc["tablas"]) & tablas:
        raise ValueError("El respaldo está incompleto (faltan tablas principales)")
    return doc


def _convertir(col, v):
    if v is None:
        return None
    try:
        tipo = col.type.python_type
    except NotImplementedError:
        return v  # JSON / JSONB
    if tipo is datetime and isinstance(v, str):
        return datetime.fromisoformat(v)
    if tipo is date and isinstance(v, str):
        return date.fromisoformat(v[:10])
    if tipo is Decimal and not isinstance(v, Decimal):
        return Decimal(str(v))
    return v


def restaurar(db: Session, doc: dict) -> dict:
    """Borra todo y carga el contenido del respaldo. El llamador hace commit (o rollback si falla)."""
    tablas = Base.metadata.sorted_tables
    nombres = ", ".join(f'"{t.name}"' for t in tablas)
    db.execute(text(f"TRUNCATE {nombres} RESTART IDENTITY CASCADE"))
    conteos = {}
    for t in tablas:
        filas = doc["tablas"].get(t.name) or []
        cols = {c.name: c for c in t.columns}
        limpias = [{k: _convertir(cols[k], v) for k, v in f.items() if k in cols} for f in filas]
        for i in range(0, len(limpias), 500):
            db.execute(t.insert(), limpias[i:i + 500])
        conteos[t.name] = len(limpias)
        # que los siguientes registros continúen después del último id restaurado
        if "id" in cols and len(t.primary_key.columns) == 1:
            seq = db.scalar(text("SELECT pg_get_serial_sequence(:t, 'id')"), {"t": t.name})
            if seq:
                maximo = db.scalar(select(func.max(t.c.id)))
                db.execute(text("SELECT setval(CAST(:s AS regclass), :v, :llamado)"),
                           {"s": seq, "v": maximo or 1, "llamado": maximo is not None})
    return conteos
