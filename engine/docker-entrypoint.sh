#!/bin/sh
# ヘッドレス Chrome は検知されやすく、実証済みのレシピは実ブラウザ前提で通してある。
# そのためコンテナ内でも既定では Xvfb（仮想ディスプレイ）の上で通常起動する。
# ENGINE_HEADLESS=1 を渡した場合だけ --headless=new で動かす。
set -e

if [ "${ENGINE_HEADLESS:-0}" != "1" ]; then
  display="${DISPLAY:-:99}"
  number="${display#:}"
  lock="/tmp/.X${number}-lock"
  socket="/tmp/.X11-unix/X${number}"

  # 再起動やクラッシュのあとに前回のロックが残っていると、Xvfb が
  # 「Server is already active for display 99」で起動できずに落ちる。
  # ロックの PID がまだ生きていればその Xvfb をそのまま使い、
  # 死んでいればロックとソケットを消してから起動し直す。
  reuse=0
  if [ -f "${lock}" ]; then
    pid="$(tr -cd '0-9' < "${lock}" 2>/dev/null || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null && [ -e "${socket}" ]; then
      echo "既に動いている Xvfb (pid ${pid}) を使います (DISPLAY=${display})"
      reuse=1
    else
      echo "前回の Xvfb のロックが残っていたので削除します: ${lock} ${socket}"
      rm -f "${lock}" "${socket}"
    fi
  elif [ -e "${socket}" ]; then
    echo "ロック無しのソケットが残っていたので削除します: ${socket}"
    rm -f "${socket}"
  fi

  if [ "${reuse}" = "0" ]; then
    echo "Xvfb を起動します (DISPLAY=${display}, ${XVFB_SCREEN:-1920x1080x24})"
    Xvfb "${display}" -screen 0 "${XVFB_SCREEN:-1920x1080x24}" -nolisten tcp &

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
fi

exec "$@"
