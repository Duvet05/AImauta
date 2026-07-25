# syntax=docker/dockerfile:1.7

FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de AS builder

ENV VIRTUAL_ENV=/venv \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /build
COPY requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock \
    && pip uninstall --yes pip setuptools wheel

FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de AS runtime

ENV PATH=/venv/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    AIMAUTA_INDEX_DIR=/srv/aimauta/indexes

COPY --from=builder /venv /venv
WORKDIR /app
COPY app ./app

USER 65532:65532
EXPOSE 3311

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3311/health', timeout=2).close()"]

CMD ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "3311", "--workers", "1", "--limit-concurrency", "32", "--timeout-keep-alive", "5", "--no-access-log", "--no-server-header"]

FROM runtime AS test
COPY tests ./tests
RUN python -m unittest discover -s tests -v

FROM runtime AS production
