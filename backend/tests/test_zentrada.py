"""Lector de credenciales: registra la asistencia en el curso que corresponde a la hora."""
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import entrada
from app.utils import TZ

TODOS = "L,M,X,J,V,S,D"


def _a(hora: str):
    h, m = (int(x) for x in hora.split(":"))
    return lambda: datetime.combine(date.today(), datetime.min.time().replace(hour=h, minute=m), tzinfo=TZ)


@pytest.fixture(scope="module")
def lector(admin):
    roles = {r["nombre"]: r["id"] for r in admin.get("/api/roles").json()["roles"]}
    assert "entrada" in roles
    assert admin.post("/api/usuarios", json={"username": "puerta", "nombre": "Puerta", "rol_id": roles["entrada"],
                                             "password": "secreto123"}).status_code == 201
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": "puerta", "password": "secreto123"}).status_code == 200
    hoy = date.today()
    base = {"area": "Otro", "fecha_inicio": str(hoy - timedelta(days=5)), "fecha_fin": str(hoy + timedelta(days=60)),
            "dias_clase": TODOS, "cupo_maximo": 20, "costo_inscripcion": 0, "costo_mensualidad": 100,
            "num_mensualidades": 2, "estado": "activo"}
    ids = {}
    for cod, nombre, hor in (("ENT-1", "Curso Mañana", "09:00-12:00"), ("ENT-2", "Curso Tarde", "16:00-19:00"),
                             ("ENT-3", "Curso Tarde B", "17:00-20:00")):
        r = admin.post("/api/cursos", json={**base, "codigo": cod, "nombre": nombre, "horario": hor})
        assert r.status_code == 201, r.text
        ids[cod] = r.json()["id"]
    for mat, cursos in (("ZT0001", ["ENT-1"]), ("ZT0002", ["ENT-1", "ENT-2"]), ("ZT0003", ["ENT-2", "ENT-3"]),
                        ("ZT0004", [])):
        assert admin.post("/api/alumnos", json={"matricula": mat, "nombre": "A" + mat, "apellido_paterno": "Prueba"}).status_code == 201
        for k in cursos:
            assert admin.post(f"/api/cursos/{ids[k]}/inscribir", json={"matricula": mat}).status_code in (200, 201)
    return c, ids


def test_solo_con_permiso(admin, lector):
    assert admin.post("/api/entrada/escaneo", json={"codigo": "ZT0001"}).status_code == 200  # admin tiene todos
    c = TestClient(app)
    assert c.post("/api/entrada/escaneo", json={"codigo": "ZT0001"}).status_code == 401


def test_a_tiempo_y_duplicado(lector, monkeypatch):
    c, _ = lector
    monkeypatch.setattr(entrada, "ahora", _a("09:05"))
    r = c.post("/api/entrada/escaneo", json={"codigo": " zt0002 "}).json()
    assert r["resultado"] == "ok" and r["curso"]["nombre"] == "Curso Mañana"
    r2 = c.post("/api/entrada/escaneo", json={"codigo": "ZT0002"}).json()
    assert r2["resultado"] == "ya_registrada"


def test_retardo(lector, monkeypatch):
    c, _ = lector
    monkeypatch.setattr(entrada, "ahora", _a("16:25"))
    r = c.post("/api/entrada/escaneo", json={"codigo": "ZT0002"}).json()
    assert r["resultado"] == "retardo" and r["curso"]["nombre"] == "Curso Tarde"


def test_dos_cursos_en_el_mismo_horario_pide_elegir(lector, monkeypatch):
    c, ids = lector
    monkeypatch.setattr(entrada, "ahora", _a("17:10"))
    r = c.post("/api/entrada/escaneo", json={"codigo": "ZT0003"}).json()
    assert r["resultado"] == "elegir" and len(r["opciones"]) == 2
    r = c.post("/api/entrada/escaneo", json={"codigo": "ZT0003", "curso_id": ids["ENT-3"]}).json()
    assert r["resultado"] in ("ok", "retardo") and r["curso"]["nombre"] == "Curso Tarde B"


def test_fuera_de_horario_y_otros_casos(lector, monkeypatch):
    c, _ = lector
    monkeypatch.setattr(entrada, "ahora", _a("06:00"))
    assert c.post("/api/entrada/escaneo", json={"codigo": "ZT0001"}).json()["resultado"] == "sin_clase"  # muy temprano
    monkeypatch.setattr(entrada, "ahora", _a("22:00"))
    assert c.post("/api/entrada/escaneo", json={"codigo": "ZT0001"}).json()["resultado"] == "sin_clase"  # ya terminó
    assert c.post("/api/entrada/escaneo", json={"codigo": "ZT0004"}).json()["resultado"] == "sin_clase"  # sin cursos
    assert c.post("/api/entrada/escaneo", json={"codigo": "NOEXISTE"}).json()["resultado"] == "no_encontrado"
