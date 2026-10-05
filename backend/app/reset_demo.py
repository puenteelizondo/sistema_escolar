"""Borra los alumnos de prueba (con sus inscripciones, pagos, tickets y asistencias) y carga ejemplos nuevos
con inscripción de $1,500 y mensualidades de $1,500. Conserva usuarios, planteles, instructores, cursos y la
configuración (logo, datos de la escuela, formato de ticket).

Uso:  docker compose exec backend python -m app.reset_demo --si
"""
import sys

from sqlalchemy import delete

from .db import SessionLocal
from .models import Alumno, Asistencia, Evento, Inscripcion, Mensualidad, Pago, Ticket
from .seed import _base_demo, _ejemplos
from .services import cfg_set, log


def main():
    if "--si" not in sys.argv:
        print("Esto BORRA todos los alumnos, pagos, tickets y asistencias. Ejecuta con --si para continuar.")
        sys.exit(1)
    with SessionLocal() as db:
        for tabla in (Ticket, Pago, Asistencia, Mensualidad, Inscripcion, Alumno, Evento):
            db.execute(delete(tabla))
        cfg_set(db, "ticket_siguiente", "1")
        db.flush()
        _ejemplos(db, **_base_demo(db))
        log(db, None, "datos_demo", None, None, "Datos de ejemplo restablecidos")
        db.commit()
    print("Listo: alumnos de ejemplo cargados (inscripción $1,500 + mensualidades de $1,500).")


if __name__ == "__main__":
    main()
