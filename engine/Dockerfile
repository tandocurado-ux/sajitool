# 計測エンジン（scheduler.py）を常駐させるためのイメージ。
# ビルドコンテキストはリポジトリのルート:
#   docker build -f engine/Dockerfile -t sajitool-engine .

# Debian のリリースも固定する（bookworm）。ここが動くと apt のパッケージ名
# （libasound2 → libasound2t64 など）が変わって Chrome の依存が入らなくなる。
FROM python:3.12-slim-bookworm

# ---------------------------------------------------------------------------
# Chrome のバージョン固定
#
# 以前は google-chrome-stable（常に最新）を apt で入れていたが、Docker の
# 再ビルドで Chrome が 154 に上がった途端、nodriver 0.47.0 が
# 「Failed to connect to browser」で接続できなくなり全件 error になった。
#
#   nodriver 0.47.0 は Chrome 154 と接続不可（2026-09-24 確認）。
#   上げる時は必ず単発テスト（run_once.py --dry-run）で接続確認すること。
#
# そのため Chrome for Testing の固定バージョン取得を使う。まずは 154 の
# 1つ前の stable 系である 153 系（153.0.8010.52）に固定する。
# 一覧: https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json
# ---------------------------------------------------------------------------
ARG CHROME_VERSION=153.0.8010.52
ARG CHROME_ZIP_URL=https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Tokyo \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1

# 日本語表示用フォント・仮想ディスプレイと、Chrome が必要とする共有ライブラリ。
# zip 配布の Chrome for Testing は apt が依存解決してくれないので、
# google-chrome-stable の deb が Depends に挙げているものを明示して入れる。
# 展開後に `chrome --version` が指定バージョンを返さなければビルドを止める。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl tzdata unzip \
      fonts-noto-cjk fonts-liberation \
      xvfb dbus-x11 \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 \
      libnspr4 libnss3 libpango-1.0-0 libu2f-udev libvulkan1 libx11-6 libxcb1 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      libxshmfence1 xdg-utils \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo $TZ > /etc/timezone \
 && echo "Chrome for Testing ${CHROME_VERSION} を取得します: ${CHROME_ZIP_URL}" \
 && curl -fsSL -o /tmp/chrome-linux64.zip "${CHROME_ZIP_URL}" \
 && unzip -q /tmp/chrome-linux64.zip -d /opt \
 && mv /opt/chrome-linux64 /opt/chrome \
 && rm -f /tmp/chrome-linux64.zip \
 && /opt/chrome/chrome --version \
 && /opt/chrome/chrome --version | grep -F "${CHROME_VERSION}" \
 && apt-get purge -y --auto-remove unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY engine/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY engine/ ./
RUN chmod +x /app/docker-entrypoint.sh

# レシピの必須条件（--lang=ja / Accept-Language / TZ=Asia/Tokyo）は
# device.py 側で固定している。ここで足すのはコンテナ差を吸収する分だけ。
# CHROME_PATH は上で展開した Chrome for Testing の実バイナリを指す。
ENV CHROME_PATH=/opt/chrome/chrome \
    CHROME_EXTRA_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu" \
    DISPLAY=:99 \
    XVFB_SCREEN=1920x1080x24

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "scheduler.py"]
