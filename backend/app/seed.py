"""Datos iniciales (roles, configuración, administrador) y datos de prueba."""
import random
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import ADMIN_PASSWORD, ADMIN_USER
from .models import (
    Alumno, Asistencia, Configuracion, Curso, Evento, Inscripcion, Instructor, Mensualidad, Plantel, Rol, Usuario,
)
from .permisos import ROLES_BASE
from .security import hash_password
from .services import DEFAULT_CONFIG, cfg_set, inscribir, registrar_pago, log
from .utils import add_months, hoy

DIAS = {"L": 0, "M": 1, "X": 2, "J": 3, "V": 4, "S": 5, "D": 6}


def seed_base(db: Session):
    for nombre, d in ROLES_BASE.items():
        rol = db.scalar(select(Rol).where(Rol.nombre == nombre))
        if not rol:
            db.add(Rol(nombre=nombre, etiqueta=d["etiqueta"], permisos=d["permisos"]))
        elif nombre == "administrador":
            rol.permisos = d["permisos"]  # el administrador siempre tiene todo
    db.flush()
    existentes = {c.clave for c in db.scalars(select(Configuracion))}
    for k, v in DEFAULT_CONFIG.items():
        if k not in existentes:
            db.add(Configuracion(clave=k, valor=v))
    if not db.scalar(select(Usuario.id).where(Usuario.username == ADMIN_USER)):
        rol = db.scalar(select(Rol).where(Rol.nombre == "administrador"))
        db.add(Usuario(username=ADMIN_USER, nombre="Administrador", rol_id=rol.id,
                       password_hash=hash_password(ADMIN_PASSWORD)))
    db.flush()


PRECIO_INSCRIPCION = 1500   # inscripción: se paga una sola vez
PRECIO_MENSUALIDAD = 1500   # mensualidad: se paga cada mes, igual en todos los cursos


def _obtener(db: Session, modelo, **claves):
    x = db.scalar(select(modelo).filter_by(**claves))
    if not x:
        x = modelo(**claves)
        db.add(x)
        db.flush()
    return x


def _base_demo(db: Session):
    """Planteles, instructores, usuarios de ejemplo y los 4 cursos (los crea o los pone al día)."""
    h = hoy()
    rol = {r.nombre: r for r in db.scalars(select(Rol))}
    admin = db.scalar(select(Usuario).where(Usuario.username == ADMIN_USER))

    p1 = _obtener(db, Plantel, nombre="Plantel 1 · Centro")
    p2 = _obtener(db, Plantel, nombre="Plantel 2 · Norte")
    for p, d, t, r in ((p1, "Av. Juárez 120, Centro", "555 100 2000", "Laura Medina"),
                       (p2, "Calle Industria 45, Col. Norte", "555 300 4000", "Roberto Salas")):
        p.direccion, p.telefono, p.responsable = p.direccion or d, p.telefono or t, p.responsable or r
    i1 = _obtener(db, Instructor, nombre="Juan López")
    i2 = _obtener(db, Instructor, nombre="Ana Torres")
    i3 = _obtener(db, Instructor, nombre="Luis Ramírez")
    for i, tel, mail, esp in ((i1, "555 111 2233", "juan.lopez@example.com", "Mecánica automotriz"),
                              (i2, "555 444 5566", "ana.torres@example.com", "Electricidad y electrónica"),
                              (i3, "555 777 8899", "luis.ramirez@example.com", "Diagnóstico automotriz")):
        i.telefono, i.whatsapp, i.correo, i.especialidad = i.telefono or tel, i.whatsapp or tel, i.correo or mail, i.especialidad or esp
    db.flush()

    def usuario(username, nombre, rol_nombre, clave, **extra):
        u = db.scalar(select(Usuario).where(Usuario.username == username))
        if not u:
            u = Usuario(username=username, nombre=nombre, rol_id=rol[rol_nombre].id, password_hash=hash_password(clave), **extra)
            db.add(u)
            db.flush()
        return u

    recep = usuario("recepcion", "Recepción Principal", "recepcion", "recepcion123")
    instr = usuario("instructor", "Juan López (instructor)", "instructor", "instructor123", instructor_id=i1.id)
    usuario("entrada", "Lector de entrada", "entrada", "entrada123")

    def ini_mes(n):
        return add_months(h.replace(day=1), n)

    c1_ini, c2_ini, c3_ini, c4_ini = ini_mes(-2), add_months(h, -1) + timedelta(days=4), ini_mes(1), ini_mes(-9)
    specs = {
        "c1": dict(nombre="Mecánica Automotriz", codigo="MEC-001", area="Mecánica", plantel_id=p1.id, instructor_id=i1.id,
                   descripcion="Motor, transmisión, frenos y suspensión.", fecha_inicio=c1_ini,
                   fecha_fin=add_months(c1_ini, 6) - timedelta(days=1), dias_clase="L,X,V", horario="18:00 - 21:00",
                   duracion="6 meses", cupo_maximo=20, num_mensualidades=6, estado="proximo"),
        "c2": dict(nombre="Electricidad Automotriz", codigo="ELE-001", area="Electricidad", plantel_id=p2.id, instructor_id=i2.id,
                   descripcion="Sistemas eléctricos, arranque, carga y alumbrado.", fecha_inicio=c2_ini,
                   fecha_fin=add_months(c2_ini, 6) - timedelta(days=1), dias_clase="M,J", horario="17:00 - 20:00",
                   duracion="6 meses", cupo_maximo=20, num_mensualidades=6, estado="proximo"),
        "c3": dict(nombre="Diagnóstico Automotriz", codigo="DIA-001", area="Diagnóstico automotriz", plantel_id=p1.id, instructor_id=i3.id,
                   descripcion="Escáner, osciloscopio y diagnóstico de fallas.", fecha_inicio=c3_ini,
                   fecha_fin=add_months(c3_ini, 4) - timedelta(days=1), dias_clase="S", horario="09:00 - 14:00",
                   duracion="4 meses", cupo_maximo=15, num_mensualidades=4, estado="inscripciones_abiertas"),
        "c4": dict(nombre="Electrónica Básica", codigo="EB-2026A", area="Electrónica", plantel_id=p1.id, instructor_id=i2.id,
                   descripcion="Fundamentos de electrónica.", fecha_inicio=c4_ini,
                   fecha_fin=add_months(c4_ini, 5) - timedelta(days=1), dias_clase="M,J", horario="16:00 - 18:00",
                   duracion="5 meses", cupo_maximo=20, num_mensualidades=5, estado="proximo"),
    }
    cursos = {}
    for k, sp in specs.items():
        c = db.scalar(select(Curso).where(Curso.codigo == sp["codigo"]))
        if c:  # ya existe: se conservan su plantel e instructor actuales
            sp = {x: v for x, v in sp.items() if x not in ("plantel_id", "instructor_id")}
            for campo, valor in sp.items():
                setattr(c, campo, valor)
        else:
            c = Curso(**sp)
            db.add(c)
        c.costo_inscripcion, c.costo_mensualidad = PRECIO_INSCRIPCION, PRECIO_MENSUALIDAD
        cursos[k] = c
    db.flush()
    return dict(h=h, admin=admin, recep=recep, instr=instr, cursos=cursos, p1=p1, p2=p2,
                c1_ini=c1_ini, c2_ini=c2_ini, c4_ini=c4_ini)


def seed_demo(db: Session):
    _ejemplos(db, **_base_demo(db))


def _ejemplos(db: Session, h, admin, recep, instr, cursos, p1, p2, c1_ini, c2_ini, c4_ini):
    """Alumnos de ejemplo con inscripción de $1,500 y mensualidades de $1,500: al corriente, con abono, vencidos…"""
    nombres = [
        ("EA8067", "Juan", "Pérez", "García", p1), ("EA8068", "Pedro", "López", "Martínez", p1),
        ("EA8069", "María", "García", "Soto", p1), ("EA8070", "José", "Ramírez", "Cruz", p1),
        ("EA8071", "Ana Sofía", "Hernández", "Ruiz", p2), ("EA8072", "Carlos", "Mendoza", "Díaz", p2),
        ("EA8073", "Laura", "Torres", "Vega", p2), ("EA8074", "Miguel Ángel", "Castro", "Luna", p2),
        ("EA8075", "Fernanda", "Ortiz", "Ramos", p1), ("EA8076", "Ricardo", "Flores", "Peña", p1),
    ]
    al = {}
    for n, (mat, nom, ap, am, pl) in enumerate(nombres):
        a = Alumno(matricula=mat, nombre=nom, apellido_paterno=ap, apellido_materno=am,
                   nombre_completo=f"{nom} {ap} {am}", plantel_id=pl.id, fecha_inscripcion=h - timedelta(days=100 - n * 7),
                   telefono=f"555 20{n}0 {1000 + n * 37}", whatsapp=f"555 20{n}0 {1000 + n * 37}",
                   correo=f"{nom.split()[0].lower()}.{ap.lower()}@example.com".replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u"),
                   fecha_nacimiento=date(1995 + n % 8, 1 + n, 5 + n), direccion="Domicilio conocido",
                   contacto_emergencia="Familiar de " + nom.split()[0], telefono_emergencia=f"555 90{n}0 0000",
                   estado="activo", creado_por=admin.id)
        db.add(a)
        al[mat] = a
    db.flush()

    # inscripciones (el curso c4 y c1 se inscriben antes de marcarlos con su estado real)
    insc = {}

    def ins(mat, curso, f_insc=None):
        i = inscribir(db, admin, al[mat], cursos[curso], f_insc)
        insc[(mat, curso)] = i
        return i

    ins("EA8067", "c4", c4_ini)
    for m in ("EA8067", "EA8068", "EA8069", "EA8070", "EA8076"):
        ins(m, "c1", c1_ini)
    for m in ("EA8071", "EA8072", "EA8073", "EA8074"):
        ins(m, "c2", c2_ini)
    ins("EA8074", "c3", h)
    ins("EA8075", "c3", h)
    db.flush()

    # ---- plan de pagos (se ejecuta en orden cronológico para que los tickets sean consecutivos)
    plan = []
    metodos = ["Efectivo", "Efectivo", "Transferencia", "Tarjeta", "Efectivo"]

    def paga(mat, curso, numero, fecha, monto=None, usuario=recep):
        plan.append((min(fecha, h), mat, curso, numero, monto, usuario))

    ini4 = c4_ini
    for n in range(0, 6):
        paga("EA8067", "c4", n, ini4 if n == 0 else add_months(ini4, n) - timedelta(days=2), usuario=admin if n == 0 else recep)
    paga("EA8067", "c1", 0, c1_ini)
    paga("EA8067", "c1", 1, add_months(c1_ini, 1))
    paga("EA8067", "c1", 2, add_months(c1_ini, 2))
    paga("EA8068", "c1", 0, c1_ini + timedelta(days=1))
    paga("EA8068", "c1", 1, add_months(c1_ini, 1) + timedelta(days=1))
    paga("EA8069", "c1", 0, c1_ini + timedelta(days=2))
    paga("EA8070", "c1", 0, c1_ini)
    paga("EA8070", "c1", 1, add_months(c1_ini, 1))
    paga("EA8070", "c1", 2, h, 500)  # abono de $500 hoy (quedan $1,000)
    paga("EA8076", "c1", 0, c1_ini + timedelta(days=3))
    paga("EA8071", "c2", 0, c2_ini)
    paga("EA8072", "c2", 0, c2_ini + timedelta(days=1))
    paga("EA8072", "c2", 1, h)  # pago hoy
    paga("EA8074", "c2", 0, c2_ini + timedelta(days=3), 700)  # abono a la inscripción (quedan $800)

    plan.sort(key=lambda p: (p[0], p[1], p[3]))
    for k, (fecha, mat, curso, numero, monto, usuario) in enumerate(plan):
        m = db.scalar(select(Mensualidad).where(Mensualidad.inscripcion_id == insc[(mat, curso)].id,
                                                Mensualidad.numero == numero))
        registrar_pago(db, usuario, m.id, monto if monto is not None else m.saldo, metodos[k % len(metodos)], fecha)
        db.flush()

    # ---- estados finales
    cursos["c1"].estado = "activo"
    cursos["c2"].estado = "activo"
    cursos["c4"].estado = "terminado"
    insc[("EA8067", "c4")].estado = "terminada"
    # Ricardo: se da de baja y se retira del curso
    r = insc[("EA8076", "c1")]
    r.estado, r.fecha_retiro = "retirada", h - timedelta(days=10)
    for m in db.scalars(select(Mensualidad).where(Mensualidad.inscripcion_id == r.id)):
        if float(m.pagado) == 0:
            m.cancelada = True
    al["EA8076"].estado = "baja"
    db.flush()

    # ---- asistencias (últimas clases de cursos activos)
    rnd = random.Random(8067)

    def clases(curso, limite):
        dias = {DIAS[x] for x in curso.dias_clase.split(",")}
        d, out = min(h, curso.fecha_fin), []
        while d >= curso.fecha_inicio and len(out) < limite:
            if d.weekday() in dias:
                out.append(d)
            d -= timedelta(days=1)
        return sorted(out)

    for (mat, cid), i in insc.items():
        if cid not in ("c1", "c2"):
            continue
        fechas = clases(cursos[cid], 5 if i.estado == "retirada" else 18)
        for f in fechas:
            x = rnd.random()
            est = "asistencia" if x < 0.78 else "falta" if x < 0.88 else "retardo" if x < 0.96 else "justificada"
            if mat == "EA8067":
                est = "asistencia" if x < 0.9 else "retardo"
            db.add(Asistencia(inscripcion_id=i.id, alumno_id=i.alumno_id, curso_id=i.curso_id, fecha=f,
                              estado=est, registrado_por=instr.id if cid == "c1" else admin.id))

    db.add(Evento(titulo="Examen parcial 1", tipo="examen", fecha=h + timedelta(days=7), curso_id=cursos["c1"].id,
                  descripcion="Unidades 1 y 2", creado_por=admin.id))
    db.add(Evento(titulo="Día de puertas abiertas", tipo="evento", fecha=h + timedelta(days=14),
                  descripcion="Visita de aspirantes en ambos planteles", creado_por=admin.id))

    cfg_set(db, "matricula_prefijo", "EA")
    cfg_set(db, "matricula_siguiente", "8077")
    log(db, None, "datos_demo", None, None, "Datos de prueba cargados")
    db.flush()
