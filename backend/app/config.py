"""Configuración leída de variables de entorno."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://escuela:escuela@localhost:5432/escuela"
)
SECRET_KEY = os.getenv("SECRET_KEY", "cambia-esta-clave-en-produccion")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
SESSION_HORAS = int(os.getenv("SESSION_HORAS", "12"))
BACKUP_DIR = os.getenv("BACKUP_DIR", "/backups")
CARGAR_DATOS_DEMO = os.getenv("CARGAR_DATOS_DEMO", "true").lower() == "true"
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
FRONTEND_DIR = os.getenv("FRONTEND_DIR", "")  # solo para desarrollo sin nginx
