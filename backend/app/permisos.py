"""Catálogo de permisos. El rol 'administrador' siempre tiene todos."""

PERMISOS = {
    "alumnos.ver": "Ver / buscar alumnos",
    "alumnos.crear": "Crear alumnos",
    "alumnos.editar": "Editar alumnos",
    "alumnos.baja": "Dar de baja / reactivar alumnos",
    "cursos.ver": "Consultar cursos",
    "cursos.admin": "Crear, editar y cancelar cursos",
    "inscripciones.admin": "Inscribir / retirar alumnos de cursos",
    "catalogos.admin": "Administrar planteles e instructores",
    "pagos.ver": "Ver pagos, adeudos e historial",
    "pagos.registrar": "Registrar pagos (cobro rápido)",
    "pagos.cancelar": "Cancelar pagos",
    "mensualidades.editar": "Cambiar fechas e importes de mensualidades",
    "tickets.ver": "Ver historial de tickets",
    "tickets.imprimir": "Imprimir / reimprimir tickets",
    "asistencia.ver": "Consultar asistencia",
    "asistencia.registrar": "Registrar asistencia",
    "asistencia.escanear": "Usar el lector de credenciales en la entrada",
    "calendario.ver": "Ver calendario",
    "eventos.admin": "Crear eventos y exámenes en el calendario",
    "reportes.ver": "Ver y exportar reportes",
    "usuarios.admin": "Administrar usuarios y permisos",
    "config.admin": "Configurar la escuela y el ticket",
    "respaldos.admin": "Crear y descargar respaldos",
    "bitacora.ver": "Ver registro de actividades",
}

ROLES_BASE = {
    "administrador": {
        "etiqueta": "Administrador",
        "permisos": list(PERMISOS.keys()),
    },
    "recepcion": {
        "etiqueta": "Recepción / Cajero",
        "permisos": [
            "alumnos.ver", "alumnos.crear", "cursos.ver", "pagos.ver",
            "pagos.registrar", "tickets.ver", "tickets.imprimir", "calendario.ver",
        ],
    },
    "instructor": {
        "etiqueta": "Instructor",
        "permisos": [
            "alumnos.ver", "cursos.ver", "asistencia.ver", "asistencia.registrar",
            "calendario.ver",
        ],
    },
    "entrada": {
        "etiqueta": "Entrada / Lector de credenciales",
        "permisos": ["asistencia.escanear"],
    },
}
