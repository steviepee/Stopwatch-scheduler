FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.10-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=web /web/dist ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV STATIC_DIR=/app/static \
    DB_SSL_CA=/etc/ssl/certs/ca-certificates.crt \
    PYTHONUNBUFFERED=1
EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
