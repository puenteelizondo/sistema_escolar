# Sistema escolar — Mecánica y Electricidad

Control de alumnos, cursos, mensualidades, pagos, **tickets consecutivos**, asistencia y reportes.
Pensado para que recepción haga: **buscar matrícula → cobrar → imprimir ticket** en segundos.

- **Backend:** Python 3.12 · FastAPI · SQLAlchemy · **PostgreSQL 17**
- **Frontend:** HTML + JavaScript (sin compilar), servido por nginx
- **Todo corre con Docker Compose** (3 contenedores: `db`, `backend`, `frontend`)

## Cómo iniciar (Windows)

1. Instala y abre **Docker Desktop**.
2. Doble clic en `iniciar.bat` (o en una terminal: `docker compose up -d --build`).
3. Abre **http://localhost:8080**

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `admin123` | Administrador |
| `recepcion` | `recepcion123` | Recepción / Cajero (demo) |
| `instructor` | `instructor123` | Instructor (demo) |

> Cambia las contraseñas desde **Usuarios** y **Cambiar contraseña** antes de usar el sistema de verdad.

Para detener: `detener.bat`. Los datos viven en volúmenes de Docker y **se conservan** al apagar.

## Datos de prueba
Con `CARGAR_DATOS_DEMO=true` (archivo `.env`) la primera vez se cargan 2 planteles, 3 instructores, 4 cursos,
10 alumnos (EA8067 = Juan Pérez), pagos, tickets, asistencias y usuarios demo.
**Para empezar limpio** (borra TODO): `borrar-datos.bat`, luego pon `CARGAR_DATOS_DEMO=false` en `.env` y vuelve a iniciar.
Después en *Configuración → Ticket* fija el número del siguiente ticket (p. ej. 38) y en *Matrícula y cobro* el prefijo/número de matrícula.

## Flujo de uso
- **Recepción:** *Inicio* o *Cobro rápido* → escribe la matrícula → `ENTER` (buscar) → `ENTER` (pagar) → `ENTER` (confirmar) → `Ctrl+P` (imprimir).
- **Administrador:** Cursos → *Nuevo curso* → *Inscribir alumno* (genera inscripción + mensualidades; las fechas se pueden editar en el expediente) → Pagos / Reportes / Configuración.

## Reglas importantes
- La **matrícula** es única y pertenece al alumno; un alumno puede tener varios cursos sin cambiar de matrícula.
- Los **tickets** son consecutivos y nunca se repiten. Reimprimir conserva el número. Cancelar un pago exige motivo y conserva el ticket (marcado cancelado).
- Los alumnos **no se borran**: se dan de baja y conservan pagos, tickets, cursos y asistencias.
- Porcentaje de asistencia = (asistencias + retardos + justificadas) / total de registros.
- Todo movimiento importante queda en *Configuración → Registro de actividades*.

## Impresión
*Configuración → Ticket*: 58 mm / 80 mm (térmica) o carta, título, pie, logo y número inicial. Se imprime desde el navegador
(en el diálogo elige tu impresora térmica; para impresión directa sin diálogo abre Chrome con `--kiosk-printing`) o se descarga PDF.

## Respaldos
*Configuración → Respaldos → Crear respaldo* (también descargar). Se guardan en el volumen `backups`.
Restaurar: copia el `.dump` al contenedor y ejecuta
```
docker compose cp respaldo-AAAAMMDD-HHMMSS.dump db:/tmp/r.dump
docker compose exec db pg_restore -U escuela -d escuela --clean --if-exists /tmp/r.dump
```

## Estructura
```
Proyecto_cantero/
├─ docker-compose.yml  .env  iniciar.bat  detener.bat  borrar-datos.bat
├─ backend/   app/{main,models,services,security,pdf,seed}.py  app/routers/*  tests/
└─ frontend/  index.html  css/app.css  js/{app,cobro,ticket,ui,api}.js  js/pages/*  nginx.conf
```
Pruebas del backend (desarrolladores): requieren una base PostgreSQL desechable indicada en `TEST_DATABASE_URL` (se borra al correr); ver `backend/tests/conftest.py`.
API interactiva: http://localhost:8080/api/docs

## Lector de credenciales en la entrada

Pantalla de bienvenida a pantalla completa para tomar asistencia con un lector de credenciales (código de
barras, QR o RFID que "teclea" la matrícula y presiona ENTER; casi todos los lectores USB funcionan así).

1. Crea un usuario con el rol **Entrada / Lector de credenciales** (Usuarios) — en la demo ya existe `entrada` / `entrada123`.
2. Inicia sesión con él en la computadora de la entrada: abre directamente la pantalla de bienvenida. El administrador
   también puede abrirla desde el menú **Entrada (lector)** (botón "Salir" para volver).
3. La credencial debe contener la **matrícula** del alumno (ej. `EA8067`).

Reglas: registra la asistencia en el curso que tiene clase **hoy y a esta hora** (se acepta desde 60 min antes
de la clase hasta que termina); pasada la tolerancia de 10 min cuenta como **retardo**. Si el alumno tiene dos
clases a la misma hora, la pantalla le pide elegir (tocando o con la tecla 1, 2…). Si ya se registró hoy, avisa
sin duplicar. Los tiempos se ajustan en la tabla `configuracion` (`entrada_antes_min`, `entrada_tolerancia_min`).
Las asistencias del lector aparecen en la lista del instructor y en el Excel, y el instructor puede corregirlas.

## Datos de ejemplo (inscripción $1,500 + mensualidades de $1,500)

Todos los cursos de ejemplo cobran **inscripción de $1,500** (una sola vez) y **mensualidad de $1,500** cada mes.
Los alumnos de ejemplo cubren cada caso: al corriente, con abono, vencidos, con pago hoy, retirado y curso terminado.

Para borrar los alumnos de prueba y volver a cargar los ejemplos, sin perder usuarios, cursos ni configuración,
ejecuta `reiniciar-ejemplos.bat` (o `docker compose exec backend python -m app.reset_demo --si`). El número de ticket vuelve a 1.
