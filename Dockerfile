# Build do frontend React/Vite
FROM node:20-alpine AS frontend-build
WORKDIR /web
COPY web/package.json ./
COPY web/vite.config.js ./
COPY web/index.html ./
COPY web/src ./src
RUN npm install
RUN npm run build

# Base Python + Playwright
FROM mcr.microsoft.com/playwright/python:v1.58.0-noble

WORKDIR /app

# Dependencias Python
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Garante binarios do Chromium
RUN playwright install chromium

# Copia o projeto
COPY . /app

# Copia frontend buildado
COPY --from=frontend-build /web/dist /app/web_dist

# Permissoes para usuario nao-root (pwuser ja existe na imagem base)
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app
USER pwuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PLAYWRIGHT_HEADLESS=true

EXPOSE 8000

CMD ["uvicorn", "automacao.api:app", "--host", "0.0.0.0", "--port", "8000"]
