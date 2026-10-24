"""Respaldo completo descargable y restauración (solo administrador). Va al final: restaura la base."""
import gzip
import json

from fastapi.testclient import TestClient

from app.main import app


def _login(u, p):
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": u, "password": p}).status_code == 200
    return c


def test_respaldo_y_restauracion(admin):
    antes = admin.get("/api/alumnos", params={"limit": 200}).json()["total"]
    r = admin.get("/api/respaldos/archivo")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    archivo = r.content
    doc = json.loads(gzip.decompress(archivo))
    assert doc["formato"] == "sistema-escolar-respaldo" and doc["conteos"]["alumnos"] == antes
    assert "pagos" in doc["tablas"] and "logs" in doc["tablas"]

    # cambios después del respaldo: se pierden al restaurar
    nuevo = admin.post("/api/alumnos", json={"nombre": "Despues", "apellido_paterno": "Del Respaldo"}).json()
    assert admin.get("/api/alumnos", params={"limit": 200}).json()["total"] == antes + 1

    # archivos inválidos: no tocan nada
    for malo in (b"", b"hola", gzip.compress(b'{"formato":"otro"}')):
        x = admin.post("/api/respaldos/restaurar", files={"archivo": ("x.json.gz", malo)})
        assert x.status_code == 400, x.text
    assert admin.get("/api/alumnos", params={"limit": 200}).json()["total"] == antes + 1

    x = admin.post("/api/respaldos/restaurar", files={"archivo": ("respaldo.json.gz", archivo, "application/gzip")})
    assert x.status_code == 200, x.text
    assert x.json()["alumnos"] == antes
    c = _login("admin", "admin123")
    assert c.get("/api/alumnos", params={"limit": 200}).json()["total"] == antes
    assert c.get(f"/api/alumnos/{nuevo['id']}").status_code == 404
    # los ids continúan bien: se puede seguir creando
    assert c.post("/api/alumnos", json={"nombre": "Otro", "apellido_paterno": "Nuevo"}).status_code == 201
    assert any(l["accion"] == "restaurar_respaldo" for l in c.get("/api/bitacora").json()["items"])


def test_solo_administrador(admin):
    roles = {r["nombre"]: r["id"] for r in admin.get("/api/roles").json()["roles"]}
    # aunque otro rol tenga el permiso de respaldos, no puede descargar ni restaurar el archivo completo
    admin.put(f"/api/roles/{roles['recepcion']}", json={"permisos": ["alumnos.ver", "respaldos.admin"]})
    assert admin.post("/api/usuarios", json={"username": "caja2", "nombre": "Caja", "rol_id": roles["recepcion"],
                                             "password": "secreto123"}).status_code == 201
    c = _login("caja2", "secreto123")
    assert c.get("/api/respaldos/archivo").status_code == 403
    assert c.post("/api/respaldos/restaurar", files={"archivo": ("x", b"x")}).status_code == 403
