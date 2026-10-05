# Imagen única (backend + frontend) para hospedar en Render u otro servicio de un solo contenedor.
# Para uso normal en tu PC sigue usando docker-compose.yml (que no usa este archivo).
FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=America/Mexico_City \
    FRONTEND_DIR=/srv/frontend \
    BACKUP_DIR=/tmp/backups

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY frontend ./frontend

RUN useradd -m escuela && mkdir -p /tmp/backups && chown escuela /tmp/backups
USER escuela

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
