#!/bin/sh
# ヘッドレス Chrome は検知されやすく、実証済みのレシピは実ブラウザ前提で通してある。
# そのためコンテナ内でも既定では Xvfb（仮想ディスプレイ）の上で通常起動する。
# ENGINE_HEADLESS=1 を渡した場合だけ --headless=new で動かす。
set -e

if [ "${ENGINE_HEADLESS:-0}" != "1" ]; then
  display="${DISPLAY:-:99}"
  echo "Xvfb を起動します (DISPLAY=${display}, ${XVFB_SCREEN:-1920x1080x24})"
  Xvfb "${display}" -screen 0 "${XVFB_SCREEN:-1920x1080x24}" -nolisten tcp &

  socket="/tmp/.X11-unix/X${display#:}"
  waited=0
  while [ ! -e "${socket}" ]; do
    waited=$((waited + 1))
    if [ "${waited}" -ge 100 ]; then
      echo "Xvfb を確認できませんでした。ヘッドレスに切り替えます。" >&2
      ENGINE_HEADLESS=1
      export ENGINE_HEADLESS
      break
    fi
    sleep 0.1
  done
fi

exec "$@"
