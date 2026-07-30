# Media worker: FastAPI + Genblaze + ffmpeg.
#
# ffmpeg is the reason this is a container rather than a serverless function.
# The composer shells out to it for every scene, and no Python wheel substitutes
# for it — which also rules out Vercel/Lambda for this half of the system.

FROM python:3.13-slim AS base

# ffmpeg: composition. fonts-dejavu: Pillow renders captions and provenance
# cards with truetype, and a slim image ships no fonts at all — without this the
# text silently falls back to a bitmap default and every card looks broken.
# libheif/libde265: pillow-heif decoding iPhone HEIC photos.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        libheif1 \
        libde265-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so a code edit does not reinstall the world.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user. The worker writes temp files during composition, so
# it needs a writable home, not write access to the image.
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /tmp/wanderos \
    && chown -R worker:worker /app /tmp/wanderos
USER worker

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIPELINE_TIER=dev \
    PORT=8000

EXPOSE 8000

# /health reports CAPABILITY, not just liveness — a worker that has lost piexif
# is running perfectly and must not be sent traffic, because it cannot strip GPS
# before publishing. `ok` is false in that case and this check fails, which is
# the intended behaviour.
HEALTHCHECK --interval=30s --timeout=15s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"ok": *true' || exit 1

CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
