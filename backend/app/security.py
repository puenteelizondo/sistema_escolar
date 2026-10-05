import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import SECRET_KEY, SESSION_HORAS
from .db import get_db
from .models import Usuario


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode()[:72], h.encode())
    except ValueError:
        return False


def crear_token(user: Usuario) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=SESSION_HORAS)
    return jwt.encode({"uid": user.id, "exp": exp}, SECRET_KEY, algorithm="HS256")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> Usuario:
    token = request.cookies.get("session")
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Sesión no iniciada")
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesión expirada, vuelve a iniciar sesión")
    user = db.get(Usuario, data["uid"])
    if not user or not user.activo:
        raise HTTPException(401, "Usuario no válido")
    return user


def require(*permisos: str):
    """Dependencia: exige AL MENOS uno de los permisos indicados."""

    def dep(user: Usuario = Depends(get_current_user)) -> Usuario:
        if not any(user.tiene(p) for p in permisos):
            raise HTTPException(403, "No tienes permiso para esta acción")
        return user

    return dep


# --- límite simple de intentos de login (en memoria) -----------------------
_intentos: dict[str, list[float]] = defaultdict(list)
MAX_INTENTOS = 6
VENTANA_SEG = 600


def login_bloqueado(clave: str) -> bool:
    ahora = time.time()
    _intentos[clave] = [t for t in _intentos[clave] if ahora - t < VENTANA_SEG]
    return len(_intentos[clave]) >= MAX_INTENTOS


def login_fallido(clave: str):
    _intentos[clave].append(time.time())


def login_ok(clave: str):
    _intentos.pop(clave, None)
