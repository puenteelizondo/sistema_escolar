"""Reglas de negocio: configuración, bitácora, mensualidades, pagos, tickets."""
import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from .models import (
    Alumno, Configuracion, Curso, Inscripcion, Log, Mensualidad, Pago, Plantel, Ticket, Usuario,
)
from .utils import add_months, hoy, fmt_money, money, num_ticket, ahora

# ---------------------------------------------------------------- configuración
DEFAULT_CONFIG = {
    "escuela_nombre": "Escuela de Mecánica y Electricidad",
    "logo": "",
    "direccion": "",
    "telefono": "",
    "whatsapp": "",
    "correo": "",
    "datos_fiscales": "",
    "metodos_pago": json.dumps(["Efectivo", "Transferencia", "Tarjeta", "Otro"]),
    "ticket_titulo": "CONTROL DE PAGO 2026",
    "ticket_pie": "Conserve este comprobante",
    "ticket_ancho": "80",  # 58 | 80 | carta
    "ticket_mostrar_logo": "true",
    "ticket_mostrar_concepto": "true",
    "ticket_siguiente": "1",
    "matricula_prefijo": "EA",
    "matricula_siguiente": "1",
    "dias_aviso": "5",
    "entrada_antes_min": "60",      # el lector acepta alumnos desde X min antes de la clase
    "entrada_tolerancia_min": "10",  # pasada la tolerancia, la llegada cuenta como retardo
    "ultimo_respaldo": "",
}


def cfg_all(db: Session) -> dict:
    data = dict(DEFAULT_CONFIG)
    for r in db.scalars(select(Configuracion)):
        data[r.clave] = r.valor if r.valor is not None else ""
    return data


def cfg_get(db: Session, clave: str) -> str:
    r = db.get(Configuracion, clave)
    if r is None or r.valor is None:
        return DEFAULT_CONFIG.get(clave, "")
    return r.valor


def cfg_set(db: Session, clave: str, valor: str):
    r = db.get(Configuracion, clave)
    if r is None:
        db.add(Configuracion(clave=clave, valor=valor))
    else:
        r.valor = valor


def metodos_pago(db: Session) -> list[str]:
    try:
        lst = json.loads(cfg_get(db, "metodos_pago"))
        return [str(x) for x in lst] or ["Efectivo"]
    except (ValueError, TypeError):
        return ["Efectivo"]


def dias_aviso(db: Session) -> int:
    try:
        return max(0, int(cfg_get(db, "dias_aviso")))
    except ValueError:
        return 5


# ---------------------------------------------------------------- bitácora
def log(db: Session, user: Usuario | None, accion: str, entidad: str | None = None,
        entidad_id: int | None = None, detalle: str | None = None):
    db.add(Log(usuario_id=user.id if user else None, usuario=user.username if user else "sistema",
               accion=accion, entidad=entidad, entidad_id=entidad_id, detalle=detalle))


# ---------------------------------------------------------------- estados
def estado_mens(m: Mensualidad, h: date) -> str:
    if m.cancelada:
        return "cancelada"
    if m.saldo <= 0:
        return "pagado"
    if m.fecha_limite < h:
        return "vencido"
    if Decimal(m.pagado) > 0:
        return "parcial"
    return "pendiente"


def etiqueta_mens(concepto: str, numero: int) -> str:
    return f"{concepto} {numero}" if numero and numero > 0 else concepto


def mens_dict(m: Mensualidad, h: date, aviso: int) -> dict:
    est = estado_mens(m, h)
    abierta = est in ("pendiente", "parcial", "vencido")
    return {
        "id": m.id,
        "inscripcion_id": m.inscripcion_id,
        "concepto": m.concepto,
        "numero": m.numero,
        "etiqueta": etiqueta_mens(m.concepto, m.numero),
        "fecha_limite": m.fecha_limite,
        "importe": money(m.importe),
        "pagado": money(m.pagado),
        "saldo": money(m.saldo) if not m.cancelada else 0.0,
        "estado": est,
        "por_vencer": abierta and est != "vencido" and (m.fecha_limite - h).days <= aviso,
        "dias_atraso": (h - m.fecha_limite).days if est == "vencido" else 0,
        "cancelada": m.cancelada,
    }


def alumno_dict(a: Alumno, foto: bool = False) -> dict:
    d = {
        "id": a.id, "matricula": a.matricula, "nombre": a.nombre,
        "apellido_paterno": a.apellido_paterno, "apellido_materno": a.apellido_materno,
        "nombre_completo": a.nombre_completo, "fecha_nacimiento": a.fecha_nacimiento,
        "telefono": a.telefono, "whatsapp": a.whatsapp, "correo": a.correo,
        "direccion": a.direccion, "contacto_emergencia": a.contacto_emergencia,
        "telefono_emergencia": a.telefono_emergencia, "plantel_id": a.plantel_id,
        "plantel": a.plantel.nombre if a.plantel else None,
        "fecha_inscripcion": a.fecha_inscripcion, "estado": a.estado,
    }
    if foto:
        d["foto"] = a.foto
    return d


def curso_dict(c: Curso, inscritos: int | None = None) -> dict:
    return {
        "id": c.id, "nombre": c.nombre, "codigo": c.codigo, "area": c.area,
        "descripcion": c.descripcion, "plantel_id": c.plantel_id,
        "plantel": c.plantel.nombre if c.plantel else None,
        "instructor_id": c.instructor_id,
        "instructor": c.instructor.nombre if c.instructor else None,
        "fecha_inicio": c.fecha_inicio, "fecha_fin": c.fecha_fin,
        "dias_clase": c.dias_clase, "horario": c.horario, "duracion": c.duracion,
        "cupo_maximo": c.cupo_maximo, "costo_inscripcion": money(c.costo_inscripcion),
        "costo_mensualidad": money(c.costo_mensualidad),
        "num_mensualidades": c.num_mensualidades, "estado": c.estado,
        "inscritos": inscritos,
    }


# ---------------------------------------------------------------- consultas base
def mens_stmt(*cols):
    """Mensualidades con alumno/curso/plantel. Excluye canceladas y retiradas."""
    return (
        select(*cols)
        .select_from(Mensualidad)
        .join(Inscripcion, Mensualidad.inscripcion_id == Inscripcion.id)
        .join(Alumno, Inscripcion.alumno_id == Alumno.id)
        .join(Curso, Inscripcion.curso_id == Curso.id)
        .outerjoin(Plantel, Inscripcion.plantel_id == Plantel.id)
        .where(Mensualidad.cancelada.is_(False), Inscripcion.estado != "retirada")
    )


def estados_pago_alumnos(db: Session, ids: list[int]) -> dict[int, str]:
    """Semáforo de pago para varios alumnos con una sola consulta."""
    if not ids:
        return {}
    h, aviso = hoy(), dias_aviso(db)
    res = {i: "sin_curso" for i in ids}
    activos = db.scalars(
        select(Inscripcion.alumno_id).where(Inscripcion.alumno_id.in_(ids), Inscripcion.estado == "activa").distinct()
    ).all()
    for i in activos:
        res[i] = "al_corriente"
    filas = db.execute(
        mens_stmt(Inscripcion.alumno_id, Mensualidad.fecha_limite)
        .where(Inscripcion.alumno_id.in_(ids), Mensualidad.importe - Mensualidad.pagado > 0)
    ).all()
    for alumno_id, limite in filas:
        if limite < h:
            res[alumno_id] = "vencido"
        elif (limite - h).days <= aviso and res[alumno_id] != "vencido":
            res[alumno_id] = "por_vencer"
        elif res[alumno_id] == "sin_curso":
            res[alumno_id] = "al_corriente"
    return res


def resumen_cobro(db: Session, alumno: Alumno) -> dict:
    """Todo lo que recepción necesita ver al buscar una matrícula."""
    h, aviso = hoy(), dias_aviso(db)
    inscs = db.scalars(
        select(Inscripcion).where(Inscripcion.alumno_id == alumno.id)
        .options(selectinload(Inscripcion.mensualidades), joinedload(Inscripcion.curso),
                 joinedload(Inscripcion.plantel))
        .order_by(Inscripcion.fecha_inicio.desc())
    ).unique().all()

    out_inscs, pendientes = [], []
    for i in inscs:
        mens = [mens_dict(m, h, aviso) for m in i.mensualidades]
        saldo_total = sum(m["saldo"] for m in mens)
        out_inscs.append({
            "id": i.id, "curso_id": i.curso_id, "curso": i.curso.nombre, "codigo": i.curso.codigo,
            "plantel": i.plantel.nombre if i.plantel else None, "estado": i.estado,
            "fecha_inscripcion": i.fecha_inscripcion, "fecha_inicio": i.fecha_inicio,
            "fecha_fin": i.fecha_fin, "costo_inscripcion": money(i.costo_inscripcion),
            "mensualidad": money(i.mensualidad), "num_mensualidades": i.num_mensualidades,
            "saldo_total": round(saldo_total, 2), "mensualidades": mens,
        })
        if i.estado != "retirada":
            for m in mens:
                if m["saldo"] > 0 and not m["cancelada"]:
                    pendientes.append({**m, "curso": i.curso.nombre, "curso_id": i.curso_id,
                                       "inscripcion_estado": i.estado})
    pendientes.sort(key=lambda m: (m["fecha_limite"], m["numero"]))

    activa = next((i for i in out_inscs if i["estado"] == "activa"), None)
    hay_vencido = any(m["estado"] == "vencido" for m in pendientes)
    hay_por_vencer = any(m["por_vencer"] for m in pendientes)
    if hay_vencido:
        estado = "vencido"
    elif hay_por_vencer:
        estado = "por_vencer"
    elif activa or pendientes:
        estado = "al_corriente"
    else:
        estado = "sin_curso"

    ultimo = db.execute(
        select(Pago.fecha, Pago.importe, Ticket.numero, Mensualidad.concepto, Mensualidad.numero)
        .join(Mensualidad, Pago.mensualidad_id == Mensualidad.id)
        .join(Inscripcion, Mensualidad.inscripcion_id == Inscripcion.id)
        .outerjoin(Ticket, Ticket.pago_id == Pago.id)
        .where(Inscripcion.alumno_id == alumno.id, Pago.estado == "aplicado")
        .order_by(Pago.fecha.desc(), Pago.id.desc()).limit(1)
    ).first()

    return {
        "alumno": alumno_dict(alumno, foto=True),
        "inscripciones": out_inscs,
        "curso_actual": activa,
        "estado_pago": estado,
        "proximo_pago": pendientes[0] if pendientes else None,
        "ultimo_pago": ({"fecha": ultimo[0], "importe": money(ultimo[1]), "ticket": num_ticket(ultimo[2]) if ultimo[2] else None,
                         "concepto": etiqueta_mens(ultimo[3], ultimo[4])} if ultimo else None),
        "saldo_pendiente": round(sum(m["saldo"] for m in pendientes if m["fecha_limite"] <= h), 2),
        "saldo_total": round(sum(m["saldo"] for m in pendientes), 2),
        "pendientes": pendientes,
        "metodos_pago": metodos_pago(db),
    }


# ---------------------------------------------------------------- inscripciones
def generar_mensualidades(db: Session, insc: Inscripcion):
    """Crea el calendario de pagos: inscripción + N mensualidades (mes a mes)."""
    if db.scalar(select(func.count()).select_from(Mensualidad).where(Mensualidad.inscripcion_id == insc.id)):
        raise HTTPException(409, "Esta inscripción ya tiene calendario de pagos")
    if Decimal(insc.costo_inscripcion) > 0:
        db.add(Mensualidad(inscripcion_id=insc.id, concepto="Inscripción", numero=0,
                           fecha_limite=max(insc.fecha_inscripcion, insc.fecha_inicio),
                           importe=insc.costo_inscripcion, pagado=0))
    for n in range(1, int(insc.num_mensualidades) + 1):
        db.add(Mensualidad(inscripcion_id=insc.id, concepto="Mensualidad", numero=n,
                           fecha_limite=add_months(insc.fecha_inicio, n),
                           importe=insc.mensualidad, pagado=0))


def inscribir(db: Session, user: Usuario, alumno: Alumno, curso: Curso,
              fecha_inscripcion: date | None = None, generar_calendario: bool = True) -> Inscripcion:
    if curso.estado in ("cancelado", "terminado"):
        raise HTTPException(400, f"El curso está {curso.estado}; no admite inscripciones")
    if alumno.estado == "baja":
        raise HTTPException(400, "El alumno está dado de baja. Reactívalo antes de inscribirlo")
    existente = db.scalar(select(Inscripcion).where(Inscripcion.alumno_id == alumno.id,
                                                    Inscripcion.curso_id == curso.id))
    if existente:
        if existente.estado == "retirada":
            raise HTTPException(409, "El alumno fue retirado de este curso. Contacta al administrador de sistema para reinscribirlo")
        raise HTTPException(409, "El alumno ya está inscrito en este curso")
    inscritos = db.scalar(select(func.count()).select_from(Inscripcion)
                          .where(Inscripcion.curso_id == curso.id, Inscripcion.estado != "retirada"))
    if inscritos >= curso.cupo_maximo:
        raise HTTPException(409, f"El curso ya alcanzó su cupo máximo ({curso.cupo_maximo})")
    insc = Inscripcion(
        alumno_id=alumno.id, curso_id=curso.id, plantel_id=curso.plantel_id or alumno.plantel_id,
        fecha_inscripcion=fecha_inscripcion or hoy(), fecha_inicio=curso.fecha_inicio,
        fecha_fin=curso.fecha_fin, costo_inscripcion=curso.costo_inscripcion,
        mensualidad=curso.costo_mensualidad, num_mensualidades=curso.num_mensualidades,
        estado="activa", creado_por=user.id,
    )
    db.add(insc)
    db.flush()
    if generar_calendario:
        generar_mensualidades(db, insc)
    log(db, user, "inscribir_alumno", "inscripcion", insc.id,
        f"{alumno.matricula} {alumno.nombre_completo} -> {curso.nombre} ({curso.codigo})")
    return insc


# ---------------------------------------------------------------- pagos / tickets
def siguiente_ticket(db: Session) -> int:
    """Número consecutivo sin huecos: bloquea la fila de configuración."""
    row = db.scalar(select(Configuracion).where(Configuracion.clave == "ticket_siguiente").with_for_update())
    if row is None:
        db.add(Configuracion(clave="ticket_siguiente", valor="1"))
        db.flush()
        row = db.scalar(select(Configuracion).where(Configuracion.clave == "ticket_siguiente").with_for_update())
    n = int(row.valor or 1)
    row.valor = str(n + 1)
    return n


def _dec(x) -> Decimal:
    try:
        return Decimal(str(x)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise HTTPException(400, "Importe no válido")


def registrar_pago(db: Session, user: Usuario, mensualidad_id: int, importe, metodo: str,
                   fecha: date | None = None, referencia: str | None = None) -> tuple[Pago, Ticket]:
    m = db.scalar(select(Mensualidad).where(Mensualidad.id == mensualidad_id).with_for_update())
    if not m:
        raise HTTPException(404, "Cargo no encontrado")
    if m.cancelada:
        raise HTTPException(400, "Este cargo está cancelado")
    importe = _dec(importe)
    if importe <= 0:
        raise HTTPException(400, "El importe debe ser mayor a cero")
    if importe > m.saldo:
        raise HTTPException(400, f"El importe excede el saldo pendiente ({fmt_money(m.saldo)})")
    if metodo not in metodos_pago(db):
        raise HTTPException(400, "Método de pago no válido")
    f = fecha or hoy()
    if f > hoy():
        raise HTTPException(400, "La fecha del pago no puede ser futura")

    insc = db.get(Inscripcion, m.inscripcion_id)
    alumno = db.get(Alumno, insc.alumno_id)
    curso = db.get(Curso, insc.curso_id)
    plantel = db.get(Plantel, insc.plantel_id) if insc.plantel_id else None

    pago = Pago(mensualidad_id=m.id, importe=importe, metodo=metodo, referencia=referencia or None,
                fecha=f, usuario_id=user.id, estado="aplicado")
    db.add(pago)
    db.flush()
    m.pagado = Decimal(m.pagado) + importe
    numero = siguiente_ticket(db)
    ticket = Ticket(numero=numero, pago_id=pago.id, fecha=f, plantel=plantel.nombre if plantel else None,
                    matricula=alumno.matricula, alumno=alumno.nombre_completo, curso=curso.nombre,
                    concepto=etiqueta_mens(m.concepto, m.numero), importe=importe)
    db.add(ticket)
    log(db, user, "registrar_pago", "pago", pago.id,
        f"Ticket {num_ticket(numero)} · {alumno.matricula} · {etiqueta_mens(m.concepto, m.numero)} · {fmt_money(importe)} · {metodo}")
    return pago, ticket


def cancelar_pago(db: Session, user: Usuario, pago_id: int, motivo: str) -> Pago:
    pago = db.scalar(select(Pago).where(Pago.id == pago_id).with_for_update())
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    if pago.estado == "cancelado":
        raise HTTPException(409, "El pago ya está cancelado")
    motivo = (motivo or "").strip()
    if len(motivo) < 3:
        raise HTTPException(400, "Indica el motivo de la cancelación")
    m = db.scalar(select(Mensualidad).where(Mensualidad.id == pago.mensualidad_id).with_for_update())
    m.pagado = Decimal(m.pagado) - Decimal(pago.importe)
    pago.estado = "cancelado"
    pago.cancelado_por = user.id
    pago.cancelado_en = ahora()
    pago.motivo_cancelacion = motivo[:255]
    t = db.scalar(select(Ticket).where(Ticket.pago_id == pago.id))
    log(db, user, "cancelar_pago", "pago", pago.id,
        f"Ticket {num_ticket(t.numero) if t else '-'} · {fmt_money(pago.importe)} · Motivo: {motivo}")
    return pago


def ticket_dict(t: Ticket, pago: Pago | None = None, formato: dict | None = None) -> dict:
    pago = pago or t.pago
    d = {
        "id": t.id, "numero": t.numero, "numero_texto": num_ticket(t.numero), "fecha": t.fecha,
        "plantel": t.plantel, "matricula": t.matricula, "alumno": t.alumno, "curso": t.curso,
        "concepto": t.concepto, "importe": money(t.importe), "impresiones": t.impresiones,
        "metodo": pago.metodo if pago else None, "estado": pago.estado if pago else None,
        "pago_id": t.pago_id,
    }
    if formato is not None:
        d["formato"] = formato
    return d


def formato_ticket(db: Session) -> dict:
    c = cfg_all(db)
    return {
        "escuela": c["escuela_nombre"], "titulo": c["ticket_titulo"], "pie": c["ticket_pie"],
        "ancho": c["ticket_ancho"], "logo": c["logo"] if c["ticket_mostrar_logo"] == "true" else "",
        "mostrar_concepto": c["ticket_mostrar_concepto"] == "true",
        "direccion": c["direccion"], "telefono": c["telefono"],
    }


# ---------------------------------------------------------------- pagos (consultas)
def pagos_stmt(*cols):
    return (
        select(*cols)
        .select_from(Pago)
        .join(Mensualidad, Pago.mensualidad_id == Mensualidad.id)
        .join(Inscripcion, Mensualidad.inscripcion_id == Inscripcion.id)
        .join(Alumno, Inscripcion.alumno_id == Alumno.id)
        .join(Curso, Inscripcion.curso_id == Curso.id)
        .outerjoin(Plantel, Inscripcion.plantel_id == Plantel.id)
        .outerjoin(Ticket, Ticket.pago_id == Pago.id)
        .outerjoin(Usuario, Usuario.id == Pago.usuario_id)
    )


def filtrar_pagos(stmt, f: dict):
    if f.get("q"):
        q = f["q"].strip()
        cond = [Alumno.matricula.ilike(f"%{q}%"), Alumno.nombre_completo.ilike(f"%{q}%")]
        if q.isdigit():
            cond.append(Ticket.numero == int(q))
        stmt = stmt.where(or_(*cond))
    if f.get("desde"):
        stmt = stmt.where(Pago.fecha >= f["desde"])
    if f.get("hasta"):
        stmt = stmt.where(Pago.fecha <= f["hasta"])
    if f.get("curso_id"):
        stmt = stmt.where(Curso.id == f["curso_id"])
    if f.get("plantel_id"):
        stmt = stmt.where(Inscripcion.plantel_id == f["plantel_id"])
    if f.get("usuario_id"):
        stmt = stmt.where(Pago.usuario_id == f["usuario_id"])
    if f.get("metodo"):
        stmt = stmt.where(Pago.metodo == f["metodo"])
    if f.get("estado"):
        stmt = stmt.where(Pago.estado == f["estado"])
    return stmt


PAGO_COLS = lambda: (  # noqa: E731
    Pago.id, Pago.fecha, Pago.importe, Pago.metodo, Pago.estado, Pago.referencia,
    Pago.motivo_cancelacion, Pago.cancelado_en, Pago.creado_en, Ticket.id.label("ticket_id"),
    Ticket.numero.label("ticket"), Alumno.id.label("alumno_id"), Alumno.matricula,
    Alumno.nombre_completo.label("alumno"), Curso.id.label("curso_id"), Curso.nombre.label("curso"),
    Plantel.nombre.label("plantel"), Mensualidad.concepto, Mensualidad.numero,
    Usuario.nombre.label("usuario"),
)


def pago_row_dict(r) -> dict:
    return {
        "id": r.id, "fecha": r.fecha, "importe": money(r.importe), "metodo": r.metodo,
        "estado": r.estado, "referencia": r.referencia, "motivo_cancelacion": r.motivo_cancelacion,
        "cancelado_en": r.cancelado_en, "creado_en": r.creado_en, "ticket_id": r.ticket_id,
        "ticket": num_ticket(r.ticket) if r.ticket else None, "alumno_id": r.alumno_id,
        "matricula": r.matricula, "alumno": r.alumno, "curso_id": r.curso_id, "curso": r.curso,
        "plantel": r.plantel, "concepto": etiqueta_mens(r.concepto, r.numero), "usuario": r.usuario,
    }


# ---------------------------------------------------------------- sincronización de estados
def sync_estados(db: Session):
    """Actualiza estados de cursos e inscripciones según las fechas."""
    h = hoy()
    db.execute(update(Curso).where(Curso.estado.in_(["proximo", "inscripciones_abiertas"]),
                                   Curso.fecha_inicio <= h, Curso.fecha_fin >= h).values(estado="activo"))
    db.execute(update(Curso).where(Curso.estado.in_(["proximo", "inscripciones_abiertas", "activo"]),
                                   Curso.fecha_fin < h).values(estado="terminado"))
    db.execute(update(Inscripcion).where(Inscripcion.estado == "activa", Inscripcion.fecha_fin < h)
               .values(estado="terminada"))
    db.commit()


def siguiente_matricula(db: Session) -> str:
    prefijo = (cfg_get(db, "matricula_prefijo") or "").upper()
    try:
        n = int(cfg_get(db, "matricula_siguiente") or 1)
    except ValueError:
        n = 1
    while db.scalar(select(Alumno.id).where(Alumno.matricula == f"{prefijo}{n}")):
        n += 1
    return f"{prefijo}{n}"


def usar_matricula_auto(db: Session, matricula: str):
    """Avanza el contador si la matrícula usada coincide con prefijo+número."""
    prefijo = (cfg_get(db, "matricula_prefijo") or "").upper()
    if prefijo and matricula.startswith(prefijo) and matricula[len(prefijo):].isdigit():
        n = int(matricula[len(prefijo):])
        try:
            actual = int(cfg_get(db, "matricula_siguiente") or 1)
        except ValueError:
            actual = 1
        if n >= actual:
            cfg_set(db, "matricula_siguiente", str(n + 1))
