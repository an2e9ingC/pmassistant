# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.10
FROM python:${PYTHON_VERSION}-slim

WORKDIR /app

# --mount=type=cache persists apt/pip downloads across builds:
# only re-downloads when packages change, not on every build.
RUN \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        libsqlcipher-dev \
        smbclient \
        # draw.io headless 依赖
        xvfb \
        libnss3 \
        libgtk-3-0 \
        libasound2 \
        libgbm1 \
        # CJK 字体（PDF 中正确渲染中文）
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 安装 draw.io AppImage（自解压，无需 FUSE）
ARG DRAWIO_VERSION=31.1.8
RUN curl -fsSL -o /tmp/drawio.AppImage \
        "https://github.com/jgraph/drawio-desktop/releases/download/v${DRAWIO_VERSION}/drawio-x86_64-${DRAWIO_VERSION}.AppImage" \
    && chmod +x /tmp/drawio.AppImage \
    && /tmp/drawio.AppImage --appimage-extract \
    && mv squashfs-root /opt/drawio \
    && ln -s /opt/drawio/AppRun /opt/drawio.AppImage \
    && rm /tmp/drawio.AppImage

COPY requirements.txt .
# Use Tsinghua PyPI mirror for faster downloads in China
RUN \
    --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir \
        -i https://pypi.tuna.tsinghua.edu.cn/simple/ \
        --trusted-host pypi.tuna.tsinghua.edu.cn \
        -r requirements.txt

COPY . .
RUN mkdir -p /app/data

# Bundle deployment files inside the image for easy extraction on any server
COPY docker-compose.prod.yml .env.example /app/deploy/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
