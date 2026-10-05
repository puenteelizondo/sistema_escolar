"""Modelo de datos.

ALUMNO -> INSCRIPCION -> CURSO
INSCRIPCION -> MENSUALIDADES -> PAGOS -> TICKET
ALUMNO/INSCRIPCION -> ASISTENCIAS
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

Money = Numeric(10, 2)


class Base(DeclarativeBase):
    pass


class Rol(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(30), unique=True)
    etiqueta: Mapped[str] = mapped_column(String(60))
    permisos: Mapped[list] = mapped_column(JSONB, default=list)


class Plantel(Base):
    __tablename__ = "planteles"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), unique=True)
    direccion: Mapped[str | None] = mapped_column(String(255))
    telefono: Mapped[str | None] = mapped_column(String(30))
    responsable: Mapped[str | None] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class Instructor(Base):
    __tablename__ = "instructores"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    telefono: Mapped[str | None] = mapped_column(String(30))
    whatsapp: Mapped[str | None] = mapped_column(String(30))
    correo: Mapped[str | None] = mapped_column(String(120))
    especialidad: Mapped[str | None] = mapped_column(String(120))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class Usuario(Base):
    __tablename__ = "usuarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    rol_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    instructor_id: Mapped[int | None] = mapped_column(ForeignKey("instructores.id"))
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ultimo_acceso: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    rol: Mapped[Rol] = relationship(lazy="joined")
    instructor: Mapped[Instructor | None] = relationship(lazy="joined")

    def tiene(self, permiso: str) -> bool:
        if self.rol.nombre == "administrador":
            return True
        return permiso in (self.rol.permisos or [])

    @property
    def es_instructor(self) -> bool:
        return self.rol.nombre == "instructor"


class Alumno(Base):
    __tablename__ = "alumnos"
    id: Mapped[int] = mapped_column(primary_key=True)
    matricula: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(80))
    apellido_paterno: Mapped[str] = mapped_column(String(80))
    apellido_materno: Mapped[str | None] = mapped_column(String(80))
    nombre_completo: Mapped[str] = mapped_column(String(250), index=True)
    foto: Mapped[str | None] = mapped_column(Text, deferred=True)  # data URL (opcional); no se carga en listados
    fecha_nacimiento: Mapped[date | None] = mapped_column(Date)
    telefono: Mapped[str | None] = mapped_column(String(30))
    whatsapp: Mapped[str | None] = mapped_column(String(30))
    correo: Mapped[str | None] = mapped_column(String(120))
    direccion: Mapped[str | None] = mapped_column(String(255))
    contacto_emergencia: Mapped[str | None] = mapped_column(String(120))
    telefono_emergencia: Mapped[str | None] = mapped_column(String(30))
    plantel_id: Mapped[int | None] = mapped_column(ForeignKey("planteles.id"))
    fecha_inscripcion: Mapped[date] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(20), default="activo", index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    creado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))

    plantel: Mapped[Plantel | None] = relationship()
    inscripciones: Mapped[list["Inscripcion"]] = relationship(back_populates="alumno")


class Curso(Base):
    __tablename__ = "cursos"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150))
    codigo: Mapped[str] = mapped_column(String(30), index=True)
    area: Mapped[str] = mapped_column(String(40))
    descripcion: Mapped[str | None] = mapped_column(Text)
    plantel_id: Mapped[int | None] = mapped_column(ForeignKey("planteles.id"))
    instructor_id: Mapped[int | None] = mapped_column(ForeignKey("instructores.id"))
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    dias_clase: Mapped[str | None] = mapped_column(String(30))  # "L,X,V"
    horario: Mapped[str | None] = mapped_column(String(60))
    duracion: Mapped[str | None] = mapped_column(String(60))
    cupo_maximo: Mapped[int] = mapped_column(Integer, default=30)
    costo_inscripcion: Mapped[Decimal] = mapped_column(Money, default=0)
    costo_mensualidad: Mapped[Decimal] = mapped_column(Money, default=0)
    num_mensualidades: Mapped[int] = mapped_column(Integer, default=6)
    estado: Mapped[str] = mapped_column(String(30), default="proximo", index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    plantel: Mapped[Plantel | None] = relationship()
    instructor: Mapped[Instructor | None] = relationship()
    inscripciones: Mapped[list["Inscripcion"]] = relationship(back_populates="curso")


class Inscripcion(Base):
    """Un alumno puede tener muchas inscripciones (una por curso)."""
    __tablename__ = "inscripciones"
    __table_args__ = (UniqueConstraint("alumno_id", "curso_id", name="uq_inscripcion_alumno_curso"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    alumno_id: Mapped[int] = mapped_column(ForeignKey("alumnos.id"), index=True)
    curso_id: Mapped[int] = mapped_column(ForeignKey("cursos.id"), index=True)
    plantel_id: Mapped[int | None] = mapped_column(ForeignKey("planteles.id"))
    fecha_inscripcion: Mapped[date] = mapped_column(Date)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    fecha_fin: Mapped[date] = mapped_column(Date)
    costo_inscripcion: Mapped[Decimal] = mapped_column(Money, default=0)
    mensualidad: Mapped[Decimal] = mapped_column(Money, default=0)
    num_mensualidades: Mapped[int] = mapped_column(Integer, default=0)
    estado: Mapped[str] = mapped_column(String(20), default="activa", index=True)  # activa|terminada|retirada
    fecha_retiro: Mapped[date | None] = mapped_column(Date)
    creado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    alumno: Mapped[Alumno] = relationship(back_populates="inscripciones")
    curso: Mapped[Curso] = relationship(back_populates="inscripciones")
    plantel: Mapped[Plantel | None] = relationship()
    mensualidades: Mapped[list["Mensualidad"]] = relationship(
        back_populates="inscripcion", order_by="Mensualidad.numero"
    )


class Mensualidad(Base):
    """Cada cargo del calendario de pagos (numero 0 = inscripción)."""
    __tablename__ = "mensualidades"
    id: Mapped[int] = mapped_column(primary_key=True)
    inscripcion_id: Mapped[int] = mapped_column(ForeignKey("inscripciones.id"), index=True)
    concepto: Mapped[str] = mapped_column(String(40))
    numero: Mapped[int] = mapped_column(Integer, default=0)
    fecha_limite: Mapped[date] = mapped_column(Date, index=True)
    importe: Mapped[Decimal] = mapped_column(Money)
    pagado: Mapped[Decimal] = mapped_column(Money, default=0)
    cancelada: Mapped[bool] = mapped_column(Boolean, default=False)

    inscripcion: Mapped[Inscripcion] = relationship(back_populates="mensualidades")
    pagos: Mapped[list["Pago"]] = relationship(back_populates="mensualidad")

    @property
    def saldo(self) -> Decimal:
        return Decimal(self.importe) - Decimal(self.pagado)


class Pago(Base):
    __tablename__ = "pagos"
    id: Mapped[int] = mapped_column(primary_key=True)
    mensualidad_id: Mapped[int] = mapped_column(ForeignKey("mensualidades.id"), index=True)
    importe: Mapped[Decimal] = mapped_column(Money)
    metodo: Mapped[str] = mapped_column(String(30))
    referencia: Mapped[str | None] = mapped_column(String(80))
    fecha: Mapped[date] = mapped_column(Date, index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    estado: Mapped[str] = mapped_column(String(20), default="aplicado", index=True)  # aplicado|cancelado
    cancelado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    cancelado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    motivo_cancelacion: Mapped[str | None] = mapped_column(String(255))

    mensualidad: Mapped[Mensualidad] = relationship(back_populates="pagos")
    usuario: Mapped[Usuario | None] = relationship(foreign_keys=[usuario_id])
    cancelador: Mapped[Usuario | None] = relationship(foreign_keys=[cancelado_por])
    ticket: Mapped["Ticket | None"] = relationship(back_populates="pago", uselist=False)


class Ticket(Base):
    """Un ticket por pago. Guarda los datos tal como se imprimieron."""
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    numero: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    pago_id: Mapped[int] = mapped_column(ForeignKey("pagos.id"), unique=True)
    fecha: Mapped[date] = mapped_column(Date, index=True)
    plantel: Mapped[str | None] = mapped_column(String(120))
    matricula: Mapped[str] = mapped_column(String(20), index=True)
    alumno: Mapped[str] = mapped_column(String(250))
    curso: Mapped[str] = mapped_column(String(150))
    concepto: Mapped[str] = mapped_column(String(80))
    importe: Mapped[Decimal] = mapped_column(Money)
    impresiones: Mapped[int] = mapped_column(Integer, default=0)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pago: Mapped[Pago] = relationship(back_populates="ticket")


class Asistencia(Base):
    __tablename__ = "asistencias"
    __table_args__ = (UniqueConstraint("inscripcion_id", "fecha", name="uq_asistencia_insc_fecha"),
                      Index("ix_asistencia_curso_fecha", "curso_id", "fecha"))
    id: Mapped[int] = mapped_column(primary_key=True)
    inscripcion_id: Mapped[int] = mapped_column(ForeignKey("inscripciones.id"))
    alumno_id: Mapped[int] = mapped_column(ForeignKey("alumnos.id"), index=True)
    curso_id: Mapped[int] = mapped_column(ForeignKey("cursos.id"))
    fecha: Mapped[date] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(String(20))  # asistencia|falta|retardo|justificada
    registrado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Evento(Base):
    __tablename__ = "eventos"
    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(150))
    tipo: Mapped[str] = mapped_column(String(20), default="evento")  # examen|evento
    fecha: Mapped[date] = mapped_column(Date, index=True)
    descripcion: Mapped[str | None] = mapped_column(String(255))
    curso_id: Mapped[int | None] = mapped_column(ForeignKey("cursos.id"))
    creado_por: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))

    curso: Mapped[Curso | None] = relationship()


class Configuracion(Base):
    __tablename__ = "configuracion"
    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[str | None] = mapped_column(Text)


class Log(Base):
    __tablename__ = "logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    fecha: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"))
    usuario: Mapped[str | None] = mapped_column(String(50))
    accion: Mapped[str] = mapped_column(String(60), index=True)
    entidad: Mapped[str | None] = mapped_column(String(40), index=True)
    entidad_id: Mapped[int | None] = mapped_column(Integer)
    detalle: Mapped[str | None] = mapped_column(Text)
