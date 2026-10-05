from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import COOKIE_SECURE, SESSION_HORAS
from ..db import get_db
from ..models import Rol, Usuario
from ..permisos import PERMISOS
from ..schemas import LoginIn, PasswordIn, PasswordResetIn, RolPermisosIn, UsuarioIn
from ..security import (
    crear_token, get_current_user, hash_password, login_bloqueado, login_fallido, login_ok,
    require, verify_password,
)
from ..services import log
from ..utils import ahora, dt_local

router = APIRouter(tags=["auth"])


def me_dict(u: Usuario) -> dict:
    permisos = list(PERMISOS.keys()) if u.rol.nombre == "administrador" else list(u.rol.permisos or [])
    return {
        "id": u.id, "username": u.username, "nombre": u.nombre, "rol": u.rol.nombre,
        "rol_etiqueta": u.rol.etiqueta, "permisos": permisos, "instructor_id": u.instructor_id,
    }


@router.post("/auth/login")
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    clave = f"{request.client.host if request.client else '?'}|{data.username.lower()}"
    if login_bloqueado(clave):
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos e inténtalo de nuevo")
    user = db.scalar(select(Usuario).where(Usuario.username == data.username))
    if not user or not user.activo or not verify_password(data.password, user.password_hash):
        login_fallido(clave)
        log(db, None, "login_fallido", "usuario", None, f"Usuario: {data.username}")
        db.commit()
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    login_ok(clave)
    user.ultimo_acceso = ahora()
    log(db, user, "login", "usuario", user.id)
    db.commit()
    response.set_cookie("session", crear_token(user), httponly=True, samesite="lax",
                        secure=COOKIE_SECURE, max_age=SESSION_HORAS * 3600, path="/")
    return me_dict(user)


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie("session", path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: Usuario = Depends(get_current_user)):
    return me_dict(user)


@router.post("/auth/password")
def cambiar_password(data: PasswordIn, user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.actual, user.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta")
    user.password_hash = hash_password(data.nueva)
    log(db, user, "cambiar_password", "usuario", user.id)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- usuarios
def usuario_dict(u: Usuario) -> dict:
    return {
        "id": u.id, "username": u.username, "nombre": u.nombre, "rol_id": u.rol_id,
        "rol": u.rol.etiqueta, "rol_nombre": u.rol.nombre, "instructor_id": u.instructor_id,
        "instructor": u.instructor.nombre if u.instructor else None, "activo": u.activo,
        "ultimo_acceso": dt_local(u.ultimo_acceso),
    }


@router.get("/usuarios")
def listar_usuarios(user: Usuario = Depends(require("usuarios.admin")), db: Session = Depends(get_db)):
    return [usuario_dict(u) for u in db.scalars(select(Usuario).order_by(Usuario.nombre))]


def _validar_rol_instructor(db, data: UsuarioIn):
    rol = db.get(Rol, data.rol_id)
    if not rol:
        raise HTTPException(400, "Rol no válido")
    if rol.nombre == "instructor" and not data.instructor_id:
        raise HTTPException(400, "Un usuario con rol Instructor debe vincularse a un instructor")
    return rol


@router.post("/usuarios", status_code=201)
def crear_usuario(data: UsuarioIn, user: Usuario = Depends(require("usuarios.admin")), db: Session = Depends(get_db)):
    if not data.password:
        raise HTTPException(400, "Escribe una contraseña para el nuevo usuario")
    _validar_rol_instructor(db, data)
    if db.scalar(select(Usuario.id).where(Usuario.username == data.username)):
        raise HTTPException(409, "Ese nombre de usuario ya existe")
    u = Usuario(username=data.username, nombre=data.nombre, rol_id=data.rol_id,
                instructor_id=data.instructor_id, activo=data.activo,
                password_hash=hash_password(data.password))
    db.add(u)
    db.flush()
    log(db, user, "crear_usuario", "usuario", u.id, f"{u.username}")
    db.commit()
    db.refresh(u)
    return usuario_dict(u)


@router.put("/usuarios/{uid}")
def editar_usuario(uid: int, data: UsuarioIn, user: Usuario = Depends(require("usuarios.admin")),
                   db: Session = Depends(get_db)):
    u = db.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    rol = _validar_rol_instructor(db, data)
    if db.scalar(select(Usuario.id).where(Usuario.username == data.username, Usuario.id != uid)):
        raise HTTPException(409, "Ese nombre de usuario ya existe")
    if u.id == user.id and (not data.activo or rol.nombre != "administrador"):
        raise HTTPException(400, "No puedes desactivarte ni quitarte el rol de administrador")
    u.username, u.nombre, u.rol_id = data.username, data.nombre, data.rol_id
    u.instructor_id = data.instructor_id if rol.nombre == "instructor" else None
    u.activo = data.activo
    if data.password:
        u.password_hash = hash_password(data.password)
    log(db, user, "editar_usuario", "usuario", u.id, u.username)
    db.commit()
    db.refresh(u)
    return usuario_dict(u)


@router.post("/usuarios/{uid}/password")
def reset_password(uid: int, data: PasswordResetIn, user: Usuario = Depends(require("usuarios.admin")),
                   db: Session = Depends(get_db)):
    u = db.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Usuario no encontrado")
    u.password_hash = hash_password(data.nueva)
    log(db, user, "reset_password", "usuario", u.id, u.username)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- roles y permisos
@router.get("/roles")
def listar_roles(user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "roles": [{"id": r.id, "nombre": r.nombre, "etiqueta": r.etiqueta,
                   "permisos": list(PERMISOS.keys()) if r.nombre == "administrador" else (r.permisos or []),
                   "editable": r.nombre != "administrador"}
                  for r in db.scalars(select(Rol).order_by(Rol.id))],
        "catalogo": PERMISOS,
    }


@router.put("/roles/{rid}")
def editar_permisos(rid: int, data: RolPermisosIn, user: Usuario = Depends(require("usuarios.admin")),
                    db: Session = Depends(get_db)):
    r = db.get(Rol, rid)
    if not r:
        raise HTTPException(404, "Rol no encontrado")
    if r.nombre == "administrador":
        raise HTTPException(400, "El administrador siempre tiene acceso completo")
    validos = [p for p in data.permisos if p in PERMISOS]
    r.permisos = validos
    log(db, user, "modificar_permisos", "rol", r.id, f"{r.nombre}: {', '.join(validos)}")
    db.commit()
    return {"ok": True}
