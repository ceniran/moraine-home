FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml requirements.txt LICENSE README.md ./
COPY src ./src
COPY examples ./examples
RUN pip install --no-cache-dir .

RUN useradd --system --uid 10001 --create-home moraine && mkdir -p /data /models && chown -R moraine:moraine /data /models /app
USER moraine

EXPOSE 4781 4790
CMD ["moraine-beta"]
