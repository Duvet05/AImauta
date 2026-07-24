FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml requirements.lock ./
RUN python -m venv /venv \
    && /venv/bin/pip install --require-hashes -r requirements.lock \
    && rm -rf \
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
COPY --from=builder /venv /venv
WORKDIR /app
COPY src ./src
USER aimauta

CMD ["python", "-m", "aimauta_voice.agent", "start"]
