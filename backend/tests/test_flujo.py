"""Prueba el flujo completo: matrícula -> inscripción -> cobro -> ticket -> reportes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app

ESTADO = {}


def test_login_incorrecto():
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"username": "admin", "password": "mal"}).status_code == 401
    assert c.get("/api/alumnos").status_code == 401


def test_catalogos_y_curso(admin):
    p = admin.post("/api/planteles", json={"nombre": "Plantel 1"})
    assert p.status_code == 201
    assert admin.post("/api/planteles", json={"nombre": "plantel 1"}).status_code == 409
    i = admin.post("/api/instructores", json={"nombre": "Juan López", "correo": "j@x.com"})
    assert i.status_code == 201
    hoy = date.today()
    curso = {
        "nombre": "Mecánica Automotriz", "codigo": "MEC-001", "area": "Mecánica",
        "plantel_id": p.json()["id"], "instructor_id": i.json()["id"],
        "fecha_inicio": str(hoy - timedelta(days=40)), "fecha_fin": str(hoy + timedelta(days=140)),
        "dias_clase": "L,X,V", "horario": "18:00-21:00", "cupo_maximo": 2,
        "costo_inscripcion": 500, "costo_mensualidad": 1000, "num_mensualidades": 4, "estado": "activo",
    }
    r = admin.post("/api/cursos", json=curso)
    assert r.status_code == 201, r.text
    ESTADO["curso"] = r.json()["id"]
    ESTADO["plantel"] = p.json()["id"]
    # fecha de fin anterior al inicio es rechazada
    malo = {**curso, "fecha_fin": str(hoy - timedelta(days=100))}
    assert admin.post("/api/cursos", json=malo).status_code == 422


def test_alumno_matricula_unica(admin):
    r = admin.post("/api/alumnos", json={"matricula": "ea8067", "nombre": "Juan", "apellido_paterno": "Pérez",
                                          "plantel_id": ESTADO["plantel"]})
    assert r.status_code == 201, r.text
    assert r.json()["matricula"] == "EA8067"
    ESTADO["alumno"] = r.json()["id"]
    dup = admin.post("/api/alumnos", json={"matricula": "EA8067", "nombre": "Otro", "apellido_paterno": "X"})
    assert dup.status_code == 409
    assert "EA8067" in dup.json()["detail"]
    # matrícula automática
    auto = admin.post("/api/alumnos", json={"nombre": "Pedro", "apellido_paterno": "López"})
    assert auto.status_code == 201 and auto.json()["matricula"].startswith("EA")
    ESTADO["alumno2"] = auto.json()["id"]
    assert admin.post("/api/alumnos", json={"matricula": "x", "nombre": "A", "apellido_paterno": "B"}).status_code == 422


def test_inscripcion_genera_calendario(admin):
    cid = ESTADO["curso"]
    r = admin.post(f"/api/cursos/{cid}/inscribir", json={"matricula": "EA8067"})
    assert r.status_code == 201, r.text
    assert admin.post(f"/api/cursos/{cid}/inscribir", json={"matricula": "EA8067"}).status_code == 409
    c = admin.get("/api/cobro/EA8067").json()
    mens = c["inscripciones"][0]["mensualidades"]
    assert [m["etiqueta"] for m in mens] == ["Inscripción", "Mensualidad 1", "Mensualidad 2", "Mensualidad 3", "Mensualidad 4"]
    assert mens[0]["importe"] == 500 and mens[1]["importe"] == 1000
    assert c["estado_pago"] == "vencido"  # inició hace 40 días y no ha pagado
    assert c["curso_actual"]["curso"] == "Mecánica Automotriz"
    ESTADO["mens"] = [m["id"] for m in mens]
    # cupo máximo = 2
    a2 = ESTADO["alumno2"]
    assert admin.post(f"/api/cursos/{cid}/inscribir", json={"alumno_id": a2}).status_code == 201
    extra = admin.post("/api/alumnos", json={"nombre": "Tercero", "apellido_paterno": "Z"}).json()
    r = admin.post(f"/api/cursos/{cid}/inscribir", json={"alumno_id": extra["id"]})
    assert r.status_code == 409 and "cupo" in r.json()["detail"]


def test_pagos_tickets_consecutivos(admin):
    # número inicial configurable
    assert admin.put("/api/config", json={"ticket_siguiente": 38}).status_code == 200
    m0, m1 = ESTADO["mens"][0], ESTADO["mens"][1]
    r = admin.post("/api/pagos", json={"mensualidad_id": m0, "importe": 500, "metodo": "Efectivo"})
    assert r.status_code == 201, r.text
    assert r.json()["ticket"]["numero_texto"] == "0038"
    ESTADO["pago0"], ESTADO["ticket0"] = r.json()["pago_id"], r.json()["ticket"]["id"]
    # abono a mensualidad de 1000
    r = admin.post("/api/pagos", json={"mensualidad_id": m1, "importe": 400, "metodo": "Transferencia"})
    assert r.json()["ticket"]["numero_texto"] == "0039"
    c = admin.get("/api/cobro/EA8067").json()
    m = [x for x in c["inscripciones"][0]["mensualidades"] if x["id"] == m1][0]
    assert (m["pagado"], m["saldo"]) == (400, 600)
    assert c["ultimo_pago"]["ticket"] == "0039"
    # no se puede pagar de más ni importes inválidos
    assert admin.post("/api/pagos", json={"mensualidad_id": m1, "importe": 700, "metodo": "Efectivo"}).status_code == 400
    assert admin.post("/api/pagos", json={"mensualidad_id": m1, "importe": 0, "metodo": "Efectivo"}).status_code == 422
    assert admin.post("/api/pagos", json={"mensualidad_id": m1, "importe": 100, "metodo": "Cheque"}).status_code == 400
    assert admin.post("/api/pagos", json={"mensualidad_id": m0, "importe": 1, "metodo": "Efectivo"}).status_code == 400  # ya pagada
    # los intentos fallidos NO consumen números
    r = admin.post("/api/pagos", json={"mensualidad_id": m1, "importe": 600, "metodo": "Tarjeta"})
    assert r.json()["ticket"]["numero_texto"] == "0040"
    # no se puede bajar el contador por debajo del último ticket
    assert admin.put("/api/config", json={"ticket_siguiente": 10}).status_code == 400


def test_pagos_concurrentes_numeros_unicos(admin):
    cid = ESTADO["curso"]
    ids = [m for m in ESTADO["mens"][2:]]  # M2, M3, M4 (1000 c/u)
    # varios abonos simultáneos
    def pagar(args):
        mid, imp = args
        c = TestClient(app)
        c.cookies.update(admin.cookies)
        return c.post("/api/pagos", json={"mensualidad_id": mid, "importe": imp, "metodo": "Efectivo"})
    trabajos = [(ids[0], 100), (ids[0], 100), (ids[1], 100), (ids[1], 100), (ids[2], 100), (ids[2], 100)]
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(pagar, trabajos))
    assert all(r.status_code == 201 for r in res), [r.text for r in res]
    numeros = sorted(r.json()["ticket"]["numero"] for r in res)
    assert numeros == list(range(41, 47)), numeros
    # intento simultáneo de sobrepago: solo uno cabe
    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(pagar, [(ids[0], 700), (ids[0], 700)]))
    assert sorted(r.status_code for r in res) == [201, 400]


def test_cancelar_y_reimprimir(admin):
    pid, tid = ESTADO["pago0"], ESTADO["ticket0"]
    assert admin.post(f"/api/pagos/{pid}/cancelar", json={"motivo": ""}).status_code == 422
    r = admin.post(f"/api/pagos/{pid}/cancelar", json={"motivo": "Error de captura"})
    assert r.status_code == 200, r.text
    assert admin.post(f"/api/pagos/{pid}/cancelar", json={"motivo": "otra vez"}).status_code == 409
    t = admin.get(f"/api/tickets/{tid}").json()
    assert t["estado"] == "cancelado" and t["numero_texto"] == "0038"  # el ticket se conserva
    c = admin.get("/api/cobro/EA8067").json()
    insc = c["inscripciones"][0]["mensualidades"][0]
    assert insc["pagado"] == 0 and insc["saldo"] == 500
    # reimpresión conserva el número y queda en bitácora
    admin.post(f"/api/tickets/{tid}/impresion")
    admin.post(f"/api/tickets/{tid}/impresion")
    assert admin.get(f"/api/tickets/{tid}").json()["numero_texto"] == "0038"
    b = admin.get("/api/bitacora", params={"accion": "reimprimir_ticket"}).json()
    assert b["total"] >= 1
    acc = {x["accion"] for x in admin.get("/api/bitacora").json()["items"]}
    assert {"cancelar_pago", "registrar_pago", "crear_alumno", "crear_curso"} <= acc
    # pagar de nuevo la inscripción da un número nuevo, no reutiliza 0038
    r = admin.post("/api/pagos", json={"mensualidad_id": ESTADO["mens"][0], "importe": 500, "metodo": "Efectivo"})
    assert r.json()["ticket"]["numero"] > 46


def test_pdf_ticket_y_formato(admin):
    tid = ESTADO["ticket0"]
    for ancho in ("58", "80", "carta"):
        admin.put("/api/config", json={"ticket_ancho": ancho, "ticket_titulo": "CONTROL DE PAGO 2026"})
        r = admin.get(f"/api/tickets/{tid}/pdf")
        assert r.status_code == 200 and r.content[:4] == b"%PDF", ancho
    admin.put("/api/config", json={"ticket_ancho": "80"})


def test_permisos_recepcion(recepcion):
    assert recepcion.get("/api/cobro/EA8067").status_code == 200
    assert recepcion.get("/api/alumnos", params={"q": "EA8067"}).json()["total"] == 1
    assert recepcion.post("/api/cursos", json={}).status_code in (403, 422)
    assert recepcion.get("/api/usuarios").status_code == 403
    assert recepcion.get("/api/config").status_code == 403
    assert recepcion.get("/api/respaldos").status_code == 403
    assert recepcion.get("/api/bitacora").status_code == 403
    assert recepcion.put("/api/mensualidades/1", json={"importe": 1}).status_code == 403
    r = recepcion.post("/api/pagos", json={"mensualidad_id": ESTADO["mens"][2], "importe": 1, "metodo": "Efectivo"})
    assert r.status_code == 201
    pid = r.json()["pago_id"]
    assert recepcion.post(f"/api/pagos/{pid}/cancelar", json={"motivo": "prueba"}).status_code == 403
    assert recepcion.post("/api/pagos", json={"mensualidad_id": ESTADO["mens"][3], "importe": 1,
                                              "metodo": "Efectivo", "fecha": str(date.today() - timedelta(days=3))}).status_code == 403
    me = recepcion.get("/api/auth/me").json()
    assert "pagos.registrar" in me["permisos"] and "usuarios.admin" not in me["permisos"]


def test_baja_y_reactivar(admin):
    aid = ESTADO["alumno2"]
    assert admin.post(f"/api/alumnos/{aid}/baja", json={"motivo": "Cambio de ciudad"}).status_code == 200
    a = admin.get(f"/api/alumnos/{aid}").json()
    assert a["estado"] == "baja"
    exp = admin.get(f"/api/alumnos/{aid}/expediente").json()  # el historial se conserva
    assert exp["inscripciones"]
    assert admin.post(f"/api/alumnos/{aid}/reactivar").status_code == 200


def test_asistencia(admin):
    cid = ESTADO["curso"]
    lista = admin.get(f"/api/asistencia/curso/{cid}").json()
    assert len(lista["alumnos"]) == 2
    regs = [{"inscripcion_id": a["inscripcion_id"], "estado": e}
            for a, e in zip(lista["alumnos"], ("asistencia", "falta"))]
    f = str(date.today())
    assert admin.post(f"/api/asistencia/curso/{cid}", json={"fecha": f, "registros": regs}).status_code == 200
    f2 = str(date.today() - timedelta(days=2))
    regs2 = [{"inscripcion_id": regs[0]["inscripcion_id"], "estado": "retardo"}]
    assert admin.post(f"/api/asistencia/curso/{cid}", json={"fecha": f2, "registros": regs2}).status_code == 200
    # editar el mismo día no duplica
    assert admin.post(f"/api/asistencia/curso/{cid}", json={"fecha": f, "registros": regs}).status_code == 200
    r = admin.get("/api/asistencia/alumno/EA8067").json()["cursos"][0]
    assert (r["asistencias"], r["retardos"], r["faltas"], r["total"]) == (1, 1, 0, 2)
    assert r["porcentaje"] == 100.0
    fut = str(date.today() + timedelta(days=3))
    assert admin.post(f"/api/asistencia/curso/{cid}", json={"fecha": fut, "registros": regs}).status_code == 400


def test_dashboard_y_reportes(admin):
    d = admin.get("/api/dashboard").json()
    assert d["alumnos_activos"] >= 2 and d["pagos_dia"] > 0 and d["pagos_vencidos"] >= 1
    claves = [r["key"] for r in admin.get("/api/reportes").json()]
    assert len(claves) == 15
    params = {"curso_id": ESTADO["curso"], "matricula": "EA8067"}
    for k in claves:
        j = admin.get(f"/api/reportes/{k}", params=params)
        assert j.status_code == 200, (k, j.text)
        for fmt, firma in (("xlsx", b"PK"), ("pdf", b"%PDF")):
            r = admin.get(f"/api/reportes/{k}", params={**params, "formato": fmt})
            assert r.status_code == 200 and r.content[:len(firma)] == firma, (k, fmt)
    pagos = admin.get("/api/reportes/pagos_dia").json()
    assert pagos["total"] >= 1
    fin = admin.get("/api/finanzas/resumen").json()
    assert fin["dia"] > 0 and fin["mes"] >= fin["dia"] and fin["anio"] >= fin["mes"]
    # filtros financieros
    assert admin.get("/api/finanzas/resumen", params={"metodo": "Cheque"}).json()["dia"] == 0
    # los pagos cancelados no suman
    lista = admin.get("/api/pagos", params={"estado": "aplicado"}).json()
    assert round(sum(p["importe"] for p in lista["items"]), 2) == lista["suma"]


def test_calendario_y_eventos(admin):
    e = admin.post("/api/eventos", json={"titulo": "Examen 1", "tipo": "examen", "fecha": str(date.today()),
                                          "curso_id": ESTADO["curso"]})
    assert e.status_code == 201
    mes = date.today().strftime("%Y-%m")
    items = admin.get("/api/calendario", params={"mes": mes}).json()["items"]
    tipos = {i["tipo"] for i in items}
    assert {"examen", "clase", "pago"} <= tipos
    assert admin.get("/api/calendario", params={"mes": "xx"}).status_code == 400


def test_mensualidad_editar_fecha(admin):
    mid = ESTADO["mens"][4]
    nueva = str(date.today() + timedelta(days=200))
    r = admin.put(f"/api/mensualidades/{mid}", json={"fecha_limite": nueva})
    assert r.status_code == 200 and r.json()["fecha_limite"] == nueva


def test_retirar_alumno_cancela_cargos_sin_pagos(admin):
    extra = admin.post("/api/alumnos", json={"nombre": "Retira", "apellido_paterno": "Prueba"}).json()
    c2 = admin.post("/api/cursos", json={
        "nombre": "Electricidad Básica", "codigo": "ELE-9", "area": "Electricidad",
        "fecha_inicio": str(date.today() + timedelta(days=10)), "fecha_fin": str(date.today() + timedelta(days=100)),
        "costo_inscripcion": 100, "costo_mensualidad": 200, "num_mensualidades": 2, "estado": "inscripciones_abiertas",
    }).json()
    insc = admin.post(f"/api/cursos/{c2['id']}/inscribir", json={"alumno_id": extra["id"]}).json()
    r = admin.post(f"/api/inscripciones/{insc['id']}/retirar", json={"motivo": "prueba"})
    assert r.status_code == 200 and r.json()["cargos_cancelados"] == 3
    assert admin.get(f"/api/cobro/{extra['matricula']}").json()["saldo_total"] == 0
    # curso con inscritos no se elimina
    assert admin.delete(f"/api/cursos/{c2['id']}").status_code == 409


def test_respaldo(admin):
    r = admin.post("/api/respaldos")
    assert r.status_code == 201, r.text
    lista = admin.get("/api/respaldos").json()
    assert lista["items"] and lista["ultimo"]
    d = admin.get(f"/api/respaldos/{r.json()['nombre']}")
    assert d.status_code == 200 and len(d.content) > 1000
    assert admin.get("/api/respaldos/../../etc/passwd").status_code in (404, 422)


def test_usuarios_y_permisos(admin):
    roles = admin.get("/api/roles").json()["roles"]
    recep = [r for r in roles if r["nombre"] == "recepcion"][0]
    # el admin puede quitar permisos a recepción y se aplica de inmediato
    nuevos = [p for p in recep["permisos"] if p != "tickets.imprimir"]
    assert admin.put(f"/api/roles/{recep['id']}", json={"permisos": nuevos}).status_code == 200
    c = TestClient(app)
    c.post("/api/auth/login", json={"username": "recep1", "password": "secreto123"})
    assert "tickets.imprimir" not in c.get("/api/auth/me").json()["permisos"]
    admin.put(f"/api/roles/{recep['id']}", json={"permisos": recep["permisos"]})
    adm = [r for r in roles if r["nombre"] == "administrador"][0]
    assert admin.put(f"/api/roles/{adm['id']}", json={"permisos": []}).status_code == 400
    # el instructor solo ve sus cursos
    instr = admin.get("/api/instructores").json()[0]
    rid = [r for r in roles if r["nombre"] == "instructor"][0]["id"]
    assert admin.post("/api/usuarios", json={"username": "inst1", "nombre": "Inst", "rol_id": rid,
                                             "password": "inst1234"}).status_code == 400  # falta instructor
    assert admin.post("/api/usuarios", json={"username": "inst1", "nombre": "Inst", "rol_id": rid,
                                             "instructor_id": instr["id"], "password": "inst1234"}).status_code == 201
    ci = TestClient(app)
    assert ci.post("/api/auth/login", json={"username": "inst1", "password": "inst1234"}).status_code == 200
    assert len(ci.get("/api/cursos").json()) >= 1
    assert ci.get("/api/pagos").status_code == 403
    assert ci.get("/api/cobro/EA8067").status_code == 403


def test_limite_de_intentos_de_login():
    c = TestClient(app)
    codigos = [c.post("/api/auth/login", json={"username": "noexiste", "password": "x"}).status_code for _ in range(8)]
    assert codigos[0] == 401 and codigos[-1] == 429
