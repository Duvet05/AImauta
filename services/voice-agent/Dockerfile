FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml requirements.lock ./
RUN python -m venv /venv \
    && /venv/bin/pip install --require-hashes -r requirements.lock

FROM builder AS test

ENV PATH="/venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements-test.lock ./
RUN /venv/bin/pip install --require-hashes --no-deps -r requirements-test.lock
WORKDIR /app
COPY Dockerfile ./Dockerfile
COPY pyproject.toml ./
COPY src ./src
COPY tests ./tests
RUN /venv/bin/pytest

FROM builder AS production-deps

RUN rm -rf \
        /venv/lib/python3.12/site-packages/pip \
        /venv/lib/python3.12/site-packages/pip-*.dist-info \
        /venv/bin/pip \
        /venv/bin/pip3 \
        /venv/bin/pip3.12

FROM python:3.12-slim

ENV PATH="/venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home --uid 10001 aimauta \
    && rm -rf \
        /usr/local/bin/pip \
        /usr/local/bin/pip3 \
        /usr/local/bin/pip3.12 \
        /usr/local/lib/python3.12/ensurepip \
        /usr/local/lib/python3.12/site-packages/pip \
        /usr/local/lib/python3.12/site-packages/pip-*.dist-info
COPY --from=production-deps /venv /venv
WORKDIR /app
COPY src ./src
USER aimauta

HEALTHCHECK --interval=15s --timeout=4s --start-period=15s --retries=5 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=2).close()"]

CMD ["python", "-m", "aimauta_voice.agent", "start"]
