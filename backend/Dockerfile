FROM python:3.12-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=America/Mexico_City

# postgresql-client: necesario para pg_dump (respaldos desde el sistema)
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY tests ./tests

RUN useradd -m escuela && mkdir -p /backups && chown escuela /backups
USER escuela

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
