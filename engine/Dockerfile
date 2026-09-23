# 計測エンジン（scheduler.py）を常駐させるためのイメージ。
# ビルドコンテキストはリポジトリのルート:
#   docker build -f engine/Dockerfile -t sajitool-engine .

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Tokyo \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1

# Google Chrome 安定版（Chromium ではレシピが通らない）と、
# 日本語表示用フォント・仮想ディスプレイ。
# Chrome が必要とする共有ライブラリは apt が依存解決で入れる。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tzdata \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      google-chrome-stable \
      fonts-noto-cjk \
      xvfb \
      dbus-x11 \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo $TZ > /etc/timezone \
 && apt-get purge -y --auto-remove gnupg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY engine/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY engine/ ./
RUN chmod +x /app/docker-entrypoint.sh

# レシピの必須条件（--lang=ja / Accept-Language / TZ=Asia/Tokyo）は
# device.py 側で固定している。ここで足すのはコンテナ差を吸収する分だけ。
ENV CHROME_PATH=/usr/bin/google-chrome-stable \
    CHROME_EXTRA_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu" \
    DISPLAY=:99 \
    XVFB_SCREEN=1920x1080x24

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "scheduler.py"]
