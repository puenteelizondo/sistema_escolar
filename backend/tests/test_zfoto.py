"""Fotos de alumnos: subir, servir como imagen, aparecer en la lista y quitar."""
import base64

PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002"
    "00010005fe02fe0000000049454e44ae426082")).decode()
FOTO = f"data:image/png;base64,{PNG}"


def test_foto_alumno(admin):
    r = admin.post("/api/alumnos", json={"nombre": "Foto", "apellido_paterno": "Prueba"})
    assert r.status_code in (200, 201), r.text
    aid = r.json()["id"]
    assert admin.get(f"/api/alumnos/{aid}/foto").status_code == 404
    assert admin.put(f"/api/alumnos/{aid}/foto", json={"foto": "hola"}).status_code == 422
    assert admin.put(f"/api/alumnos/{aid}/foto", json={"foto": FOTO}).status_code == 200
    img = admin.get(f"/api/alumnos/{aid}/foto")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert img.content == base64.b64decode(PNG)
    item = next(i for i in admin.get("/api/alumnos", params={"q": "Foto Prueba"}).json()["items"] if i["id"] == aid)
    assert item["foto_url"].startswith(f"/api/alumnos/{aid}/foto?v=") and "foto" not in item
    assert admin.put(f"/api/alumnos/{aid}/foto", json={"foto": None}).status_code == 200
    assert admin.get(f"/api/alumnos/{aid}/foto").status_code == 404


def test_retiro_muestra_motivo(admin):
    c = admin.post("/api/cursos", json={"nombre": "Curso retiro", "codigo": "RET-1", "area": "Otro",
                                        "fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31", "cupo_maximo": 5,
                                        "costo_inscripcion": 0, "costo_mensualidad": 100, "num_mensualidades": 2,
                                        "estado": "activo"}).json()
    a = admin.post("/api/alumnos", json={"nombre": "Retiro", "apellido_paterno": "Prueba"}).json()
    i = admin.post(f"/api/cursos/{c['id']}/inscribir", json={"alumno_id": a["id"]})
    assert i.status_code in (200, 201), i.text
    iid = i.json()["id"]
    assert admin.post(f"/api/inscripciones/{iid}/retirar", json={"motivo": "Cambió de horario"}).status_code == 200
    exp = admin.get(f"/api/alumnos/{a['id']}/expediente").json()
    ins = exp["inscripciones"][0]
    assert ins["estado"] == "retirada" and ins["retiro_motivo"] == "Cambió de horario" and ins["fecha_retiro"]


def test_datos_de_credencial(admin):
    r = admin.post("/api/alumnos", json={"nombre": "Greg", "apellido_paterno": "Prueba", "grado": "Segundo",
                                         "tipo_sangre": "O+", "contacto_emergencia": "Daniel", "parentesco_emergencia": "Papá",
                                         "telefono_emergencia": "3121775769"})
    assert r.status_code in (200, 201), r.text
    a = r.json()
    assert (a["grado"], a["tipo_sangre"], a["parentesco_emergencia"]) == ("Segundo", "O+", "Papá")
    assert admin.post("/api/alumnos", json={"nombre": "X", "apellido_paterno": "Y", "tipo_sangre": "Z+"}).status_code == 422
    rev = admin.get("/api/credencial/reverso").json()
    assert rev["credencial_encabezado_frente"].startswith("CEAG") and rev["cct"]
