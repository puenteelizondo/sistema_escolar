import os
import tempfile

# Nunca usa DATABASE_URL: las pruebas BORRAN el esquema de la base indicada.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://escuela:escuela@localhost:5432/escuela_test")
os.environ["CARGAR_DATOS_DEMO"] = "false"
os.environ["BACKUP_DIR"] = tempfile.mkdtemp(prefix="respaldos-")
os.environ["ADMIN_USER"] = "admin"
os.environ["ADMIN_PASSWORD"] = "admin123"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture(scope="session")
def admin():
    with engine.begin() as c:
        c.execute(text("drop schema public cascade; create schema public;"))
    with TestClient(app) as client:  # ejecuta el arranque (tablas + admin)
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200, r.text
        yield client


@pytest.fixture(scope="session")
def recepcion(admin):
    roles = {r["nombre"]: r["id"] for r in admin.get("/api/roles").json()["roles"]}
    r = admin.post("/api/usuarios", json={"username": "recep1", "nombre": "Recepción Test", "rol_id": roles["recepcion"],
                                          "password": "secreto123"})
    assert r.status_code == 201, r.text
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": "recep1", "password": "secreto123"}).status_code == 200
    return c


@pytest.fixture(scope="session", autouse=True)
def _base_lista(admin):
    """Garantiza que la base y el arranque existan antes de cualquier prueba."""
    return admin
