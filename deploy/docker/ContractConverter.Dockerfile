# Optional local/server DOCX-to-PDF converter. No network or additional capabilities at runtime.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core poppler-utils python3 python3-pil \
    && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp
USER 10001
ENTRYPOINT ["soffice"]
