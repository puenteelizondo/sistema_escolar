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
