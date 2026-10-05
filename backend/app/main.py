import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from .config import CARGAR_DATOS_DEMO, FRONTEND_DIR
from .db import SessionLocal, engine
from .models import Alumno, Base
from .routers import admin, alumnos, asistencia, auth, catalogos, cursos, entrada, pagos, panel, reportes
from .seed import seed_base, seed_demo
from .services import cfg_get, cfg_set, sync_estados

logger = logging.getLogger("escuela")


def esperar_bd(intentos: int = 40):
    for i in range(intentos):
        try:
            with engine.connect() as c:
                c.execute(text("select 1"))
            return
        except Exception as e:  # noqa: BLE001
            logger.warning("Esperando base de datos (%s/%s): %s", i + 1, intentos, str(e)[:80])
            time.sleep(2)
    raise RuntimeError("No se pudo conectar a la base de datos")


@asynccontextmanager
async def lifespan(app: FastAPI):
    esperar_bd()
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_base(db)
        db.commit()
        if CARGAR_DATOS_DEMO and not cfg_get(db, "demo_cargado") and not db.scalar(select(func.count()).select_from(Alumno)):
            seed_demo(db)
            cfg_set(db, "demo_cargado", "1")
            db.commit()
        sync_estados(db)
    yield


app = FastAPI(title="Sistema Escolar — Mecánica y Electricidad", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

for r in (auth, catalogos, alumnos, cursos, pagos, asistencia, entrada, panel, reportes, admin):
    app.include_router(r.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.middleware("http")
async def cabeceras(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif "Cache-Control" not in resp.headers:
        resp.headers["Cache-Control"] = "no-cache"
    return resp


MENSAJES = {
    "missing": "es obligatorio",
    "string_too_short": "es demasiado corto",
    "string_too_long": "es demasiado largo",
    "greater_than": "debe ser mayor",
    "greater_than_equal": "no puede ser menor",
    "less_than_equal": "es demasiado grande",
    "date_from_datetime_parsing": "fecha no válida",
    "date_parsing": "fecha no válida",
    "int_parsing": "debe ser un número entero",
    "decimal_parsing": "debe ser un número",
    "string_pattern_mismatch": "formato no válido",
}


@app.exception_handler(RequestValidationError)
async def validacion(request: Request, exc: RequestValidationError):
    partes = []
    for e in exc.errors():
        campo = ".".join(str(x) for x in e["loc"] if x not in ("body", "query", "path")).replace("_", " ")
        if e["type"] == "value_error":
            msg = str(e["msg"]).replace("Value error, ", "")
        elif "email" in e["type"] or "email" in str(e["msg"]).lower():
            msg = "correo no válido"
        else:
            msg = MENSAJES.get(e["type"], e["msg"])
        partes.append(f"{campo}: {msg}" if campo else msg)
    return JSONResponse(status_code=422, content={"detail": "; ".join(partes) or "Datos no válidos"})


@app.exception_handler(IntegrityError)
async def integridad(request: Request, exc: IntegrityError):
    logger.warning("IntegrityError: %s", exc)
    return JSONResponse(status_code=409, content={"detail": "El registro entra en conflicto con datos existentes (duplicado o referencia en uso)"})


if FRONTEND_DIR and os.path.isdir(FRONTEND_DIR):  # sin nginx: desarrollo local o despliegue en un solo contenedor (Render)
    app.add_middleware(GZipMiddleware, minimum_size=800)
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
