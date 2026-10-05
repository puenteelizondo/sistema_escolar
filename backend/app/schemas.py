"""Esquemas de entrada (validación de formularios)."""
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

MATRICULA_RE = re.compile(r"^[A-Z0-9\-]{3,20}$")

ESTADOS_ALUMNO = ("activo", "inactivo", "terminado", "suspendido", "baja")
AREAS = ("Mecánica", "Electricidad", "Electrónica", "Diagnóstico automotriz", "Otro")
ESTADOS_CURSO = ("proximo", "inscripciones_abiertas", "activo", "terminado", "cancelado")
ESTADOS_ASISTENCIA = ("asistencia", "falta", "retardo", "justificada")


def _limpia(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class Base(BaseModel):
    model_config = {"str_strip_whitespace": True}


class LoginIn(Base):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class PasswordIn(Base):
    actual: str
    nueva: str = Field(min_length=6, max_length=100)


class UsuarioIn(Base):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.\-]+$")
    nombre: str = Field(min_length=2, max_length=120)
    rol_id: int
    instructor_id: int | None = None
    activo: bool = True
    password: str | None = Field(default=None, min_length=6, max_length=100)


class PasswordResetIn(Base):
    nueva: str = Field(min_length=6, max_length=100)


class RolPermisosIn(Base):
    permisos: list[str]


class PlantelIn(Base):
    nombre: str = Field(min_length=2, max_length=120)
    direccion: str | None = None
    telefono: str | None = None
    responsable: str | None = None
    activo: bool = True

    _v = field_validator("direccion", "telefono", "responsable", mode="before")(_limpia)


class InstructorIn(Base):
    nombre: str = Field(min_length=2, max_length=120)
    telefono: str | None = None
    whatsapp: str | None = None
    correo: EmailStr | None = None
    especialidad: str | None = None
    activo: bool = True

    _v = field_validator("telefono", "whatsapp", "correo", "especialidad", mode="before")(_limpia)


class AlumnoIn(Base):
    matricula: str | None = None
    nombre: str = Field(min_length=1, max_length=80)
    apellido_paterno: str = Field(min_length=1, max_length=80)
    apellido_materno: str | None = None
    foto: str | None = None
    fecha_nacimiento: date | None = None
    telefono: str | None = None
    whatsapp: str | None = None
    correo: EmailStr | None = None
    direccion: str | None = None
    contacto_emergencia: str | None = None
    telefono_emergencia: str | None = None
    plantel_id: int | None = None
    fecha_inscripcion: date | None = None
    estado: Literal["activo", "inactivo", "terminado", "suspendido", "baja"] | None = None

    _v = field_validator("matricula", "apellido_materno", "foto", "telefono", "whatsapp", "correo",
                         "direccion", "contacto_emergencia", "telefono_emergencia", mode="before")(_limpia)

    @field_validator("matricula")
    @classmethod
    def _mat(cls, v):
        if v is None:
            return v
        v = v.upper().replace(" ", "")
        if not MATRICULA_RE.match(v):
            raise ValueError("La matrícula solo puede tener letras, números y guion (3 a 20 caracteres)")
        return v

    @field_validator("foto")
    @classmethod
    def _foto(cls, v):
        if v and (not v.startswith("data:image/") or len(v) > 600_000):
            raise ValueError("Foto no válida o demasiado grande")
        return v


class FotoIn(Base):
    foto: str | None = None

    @field_validator("foto")
    @classmethod
    def _foto(cls, v):
        if v and (not v.startswith("data:image/") or len(v) > 600_000):
            raise ValueError("Foto no válida o demasiado grande")
        return v or None


class MotivoIn(Base):
    motivo: str | None = None


class CursoIn(Base):
    nombre: str = Field(min_length=3, max_length=150)
    codigo: str = Field(min_length=2, max_length=30)
    area: Literal["Mecánica", "Electricidad", "Electrónica", "Diagnóstico automotriz", "Otro"]
    descripcion: str | None = None
    plantel_id: int | None = None
    instructor_id: int | None = None
    fecha_inicio: date
    fecha_fin: date
    dias_clase: str | None = None
    horario: str | None = None
    duracion: str | None = None
    cupo_maximo: int = Field(default=30, ge=1, le=500)
    costo_inscripcion: Decimal = Field(default=Decimal(0), ge=0, le=1_000_000)
    costo_mensualidad: Decimal = Field(default=Decimal(0), ge=0, le=1_000_000)
    num_mensualidades: int = Field(default=6, ge=0, le=60)
    estado: Literal["proximo", "inscripciones_abiertas", "activo", "terminado", "cancelado"] = "proximo"

    _v = field_validator("descripcion", "dias_clase", "horario", "duracion", mode="before")(_limpia)

    @field_validator("fecha_fin")
    @classmethod
    def _fechas(cls, v, info):
        ini = info.data.get("fecha_inicio")
        if ini and v < ini:
            raise ValueError("La fecha de terminación no puede ser anterior al inicio")
        return v


class InscribirIn(Base):
    matricula: str | None = None
    alumno_id: int | None = None
    fecha_inscripcion: date | None = None
    generar_calendario: bool = True

    @field_validator("matricula")
    @classmethod
    def _m(cls, v):
        return v.upper().replace(" ", "") if v else None


class MensualidadIn(Base):
    fecha_limite: date | None = None
    importe: Decimal | None = Field(default=None, ge=0, le=1_000_000)


class PagoIn(Base):
    mensualidad_id: int
    importe: Decimal = Field(gt=0, le=1_000_000)
    metodo: str = "Efectivo"
    referencia: str | None = Field(default=None, max_length=80)
    fecha: date | None = None

    _v = field_validator("referencia", mode="before")(_limpia)


class CancelarPagoIn(Base):
    motivo: str = Field(min_length=3, max_length=255)


class AsistenciaRegistro(Base):
    inscripcion_id: int
    estado: Literal["asistencia", "falta", "retardo", "justificada"]


class AsistenciaIn(Base):
    fecha: date
    registros: list[AsistenciaRegistro]


class EventoIn(Base):
    titulo: str = Field(min_length=2, max_length=150)
    tipo: Literal["examen", "evento"] = "evento"
    fecha: date
    descripcion: str | None = Field(default=None, max_length=255)
    curso_id: int | None = None

    _v = field_validator("descripcion", mode="before")(_limpia)
