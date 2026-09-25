"""デバイス記述子と、検索エンジン共通のブラウザ context まわり。

pc / mobile の context 定義に加えて、Google・Yahoo の両レシピが共有する
低レベル操作（起動・プロキシ・リクエスト遮断・地点指定・人間速度タイプ・
CDP Enter・結果ポーリング）をここに置く。

検索エンジン固有の URL・セレクタ・成否判定は search_google.py /
search_yahoo.py 側にある。
"""

from __future__ import annotations

import asyncio
import json
import os
import platform as _platform
import random
import re
import string
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

import nodriver as uc
from nodriver import cdp
from nodriver.core.connection import ProtocolException

ACCEPT_LANGUAGE = "ja-JP,ja;q=0.9"
TIMEZONE_ID = "Asia/Tokyo"
EXIT_IP_ENDPOINT = "https://api.ipify.org?format=json"

# 帯域節約のため落とすリソース種別。HTML/JS/CSS は通す。
BLOCKED_RESOURCE_TYPES = frozenset(
    {
        cdp.network.ResourceType.IMAGE,
        cdp.network.ResourceType.MEDIA,
        cdp.network.ResourceType.FONT,
    }
)

WINDOWS_CHROME_PATHS = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)


class SearchError(RuntimeError):
    """検索フローが続行不能になったときに投げる。"""


class SearchBoxNotFound(SearchError):
    """検索窓が見つからなかった。診断用にページの状態を持つ。"""

    def __init__(self, message: str, diagnostics: Optional[dict[str, str]] = None):
        super().__init__(message)
        self.diagnostics = diagnostics or {}


# CDP 通信が切れた（ページ遷移中にコマンドを送った等）ときの outcome.error。
# セッションを変えれば通る見込みがあるので、runner 側でリトライ対象にしている。
PROTOCOL_ERROR = "protocol_error"


def is_protocol_error(caught: BaseException) -> bool:
    """nodriver の ProtocolException（"Not attached to an active page" など）か。"""
    return isinstance(caught, ProtocolException)


def classify_error(caught: BaseException) -> str:
    """outcome.error に入れる文字列。分類できるものは短いコードにする。"""
    if is_protocol_error(caught):
        return PROTOCOL_ERROR
    return f"{type(caught).__name__}: {caught}"


# --------------------------------------------------------------------------
# ログ（段階マーカー・例外・環境情報）
#
# ここにあるのは print するだけの関数。レシピの手順や待ち時間には触れない。
# 1実行の中で「どの段階の直後で例外が出たか」を Render のログだけで
# 読めるようにするためのもの。
# --------------------------------------------------------------------------

# 直近に通過した段階名。Chrome は1プロセスずつしか動かさないので
# モジュール変数で足りる（並列実行はしない前提）。
_last_stage: str = ""


def _stamp() -> str:
    return time.strftime("%H:%M:%S")


def stage(name: str, detail: str = "") -> None:
    """段階マーカーを1行出す。例外が出たとき「直前の段階」として参照する。"""
    global _last_stage
    _last_stage = name
    line = f"  [{_stamp()}] ▶ {name}"
    if detail:
        line += f": {detail}"
    print(line, flush=True)


def last_stage() -> str:
    """直近に通過した段階名。まだ何も通っていなければ「（未開始）」。"""
    return _last_stage or "（未開始）"


def reset_stage() -> None:
    global _last_stage
    _last_stage = ""


def format_exception_lines(caught: BaseException) -> list[str]:
    """例外の型・メッセージ・traceback 全文を行のリストにする。"""
    text = "".join(
        traceback.format_exception(type(caught), caught, caught.__traceback__)
    )
    return text.rstrip().splitlines()


def log_exception(caught: BaseException, *, context: str = "") -> None:
    """例外の型・メッセージ・直前の段階・traceback 全文をログに出す。

    status だけ runs に残して原因が消えてしまわないよう、
    例外を握る場所では必ずこれを呼ぶ。
    """
    head = f"  [{_stamp()}] ✖ 例外"
    if context:
        head += f"（{context}）"
    print(f"{head}: {type(caught).__name__}: {caught}", flush=True)
    print(f"    直前の段階: {last_stage()}", flush=True)
    print("    traceback:", flush=True)
    for line in format_exception_lines(caught):
        print(f"    | {line}", flush=True)


# 起動時に「設定されているか」だけを出す環境変数。値は出さない。
ENV_KEYS_OF_INTEREST: tuple[str, ...] = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SOAX_PASS",
    "SOAX_ENDPOINT",
    "SOAX_COUNTRY",
    "SOAX_NETWORK",
    "SOAX_ROTATE_SECONDS",
    "SOAX_REGION_ENABLED",
    "SOAX_SESSION_ID",
    "SOAX_GOOGLE_NETWORK",
    "SOAX_GOOGLE_OMIT_REGION",
    "SOAX_GOOGLE_ROTATE_SECONDS",
    "ALERT_WEBHOOK_URL",
    "CHROME_PATH",
    "CHROME_EXTRA_ARGS",
    "ENGINE_HEADLESS",
    "DISPLAY",
    "XVFB_SCREEN",
    "TZ",
    "GOOGLE_INTERVAL_MIN_SECONDS",
    "GOOGLE_INTERVAL_MAX_SECONDS",
    "YAHOO_INTERVAL_MIN_SECONDS",
    "YAHOO_INTERVAL_MAX_SECONDS",
    "QUEUE_MAX_ITEMS",
)


def chrome_version(path: str) -> str:
    """Chrome のバージョン文字列。取れなければ理由を返す（起動は止めない）。

    Windows の chrome.exe は --version で何も出さない（GUI が立ち上がりうる）ので、
    exe の隣にあるバージョン名のディレクトリから読む。
    """
    if sys.platform == "win32":
        parent = Path(path).parent
        try:
            versions = sorted(
                child.name
                for child in parent.iterdir()
                if child.is_dir() and re.fullmatch(r"\d+(\.\d+){3}", child.name)
            )
        except OSError as caught:
            return f"取得できず（{type(caught).__name__}: {caught}）"
        return versions[-1] if versions else "取得できず（バージョンディレクトリなし）"

    try:
        completed = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception as caught:  # noqa: BLE001 - 環境情報の取得で落とさない
        return f"取得できず（{type(caught).__name__}: {caught}）"
    output = (completed.stdout or "").strip() or (completed.stderr or "").strip()
    if not output:
        return f"取得できず（--version の出力なし, exit={completed.returncode}）"
    return output.splitlines()[0][:120]


def nodriver_version() -> str:
    try:
        from importlib.metadata import version

        return version("nodriver")
    except Exception:  # noqa: BLE001
        return getattr(uc, "__version__", "不明")


def environment_lines() -> list[str]:
    """起動時に1回出す環境情報。秘密値は出さず「設定あり/未設定」だけ。"""
    try:
        chrome = find_chrome()
        chrome_line = f"{chrome}（{chrome_version(chrome)}）"
    except SearchError as caught:
        chrome_line = f"見つかりません: {caught}"

    present = [name for name in ENV_KEYS_OF_INTEREST if os.environ.get(name, "").strip()]
    missing = [name for name in ENV_KEYS_OF_INTEREST if name not in present]

    return [
        f"Python     : {_platform.python_version()}（{sys.platform}）",
        f"OS         : {_platform.platform()}",
        f"Chrome     : {chrome_line}",
        f"nodriver   : {nodriver_version()}",
        f"環境変数あり: {', '.join(present) or '-'}",
        f"環境変数なし: {', '.join(missing) or '-'}",
    ]


async def _chrome_self_check(headless: bool) -> str:
    """nodriver で Chrome を起動 → CDP でバージョン取得 → 終了。要約文を返す。"""
    browser = await start_browser(proxy=None, headless=headless)
    try:
        protocol, product, _revision, _user_agent, js_version = (
            await browser.connection.send(cdp.browser.get_version())
        )
        return f"{product}, CDP {protocol}, V8 {js_version}"
    finally:
        await close_browser(browser, context="セルフチェック")


def chrome_self_check(*, headless: bool) -> bool:
    """起動時に1回、Chrome と nodriver が本当に接続できるかを確かめる。

    Chrome のメジャーバージョンが上がると nodriver が
    「Failed to connect to browser」で接続できなくなることがある
    （nodriver 0.47.0 と Chrome 154 で実際に起きた）。実行を待たずに
    起動直後のログで気づけるようにする。NG でも動作は止めない。
    """
    print("Chrome 接続セルフチェックを実行します（起動 → バージョン取得 → 終了）")
    try:
        summary = asyncio.run(_chrome_self_check(headless))
    except Exception as caught:  # noqa: BLE001 - NG でも常駐は続ける
        print(f"Chrome 接続セルフチェック: NG（{type(caught).__name__}: {caught}）")
        log_exception(caught, context="Chrome 接続セルフチェック")
        print(
            "  ! Chrome と nodriver の組み合わせを疑ってください"
            "（engine/Dockerfile の CHROME_VERSION と requirements.txt の nodriver）。"
            "このまま続行しますが、実行は error になる可能性が高いです。"
        )
        return False
    print(f"Chrome 接続セルフチェック: OK（{summary}）")
    return True


# --------------------------------------------------------------------------
# デバイス記述子
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class DeviceProfile:
    """UA・画面サイズ・deviceScaleFactor・タッチをセットで一貫させる記述子。

    UA だけ差し替えるのは検知されるので、必ずまとめて適用する。
    """

    name: str
    width: int
    height: int
    device_scale_factor: float
    mobile: bool
    touch_points: int
    ua_platform: str
    ua_platform_version: str
    ua_model: str
    ua_architecture: str
    orientation: str
    orientation_angle: int


DEVICE_PROFILES: dict[str, DeviceProfile] = {
    "pc": DeviceProfile(
        name="pc",
        width=1280,
        height=800,
        device_scale_factor=1.0,
        mobile=False,
        touch_points=0,
        ua_platform="Windows",
        ua_platform_version="15.0.0",
        ua_model="",
        ua_architecture="x86",
        orientation="landscapePrimary",
        orientation_angle=0,
    ),
    "mobile": DeviceProfile(
        name="mobile",
        width=412,
        height=915,
        device_scale_factor=2.625,
        mobile=True,
        touch_points=5,
        ua_platform="Android",
        ua_platform_version="13.0.0",
        ua_model="Pixel 7",
        ua_architecture="",
        orientation="portraitPrimary",
        orientation_angle=0,
    ),
}


def resolve_device(device: str) -> DeviceProfile:
    profile = DEVICE_PROFILES.get(device)
    if profile is None:
        raise SearchError(f"未対応のデバイスです: {device}")
    return profile


# --------------------------------------------------------------------------
# SOAX プロキシ
# --------------------------------------------------------------------------

# SOAX はユーザー名にオプション文字列そのものを入れる方式。
# パッケージの識別はパスワード側で行われるので、ユーザー名に package ID は入れない。
# 例: country-jp-region-osaka-network-res-rotate-timed_300-session-ab12cd34
#
# 注意（実測で確定済み）:
#   - session の値は英数字のみ。ハイフン等が入るとトークン区切りと解釈されて壊れる
#   - onerror トークンは付けない（onerror-rotate は無効で 400 になる）
#   - region は英語小文字（osaka, aichi ...）
#   - network は res（住宅）/ mob（モバイル）。契約パッケージで両方有効なら
#     Google だけ mob に逃がせる（SOAX_GOOGLE_NETWORK）
PREFECTURE_TO_SOAX_REGION: dict[str, str] = {
    "北海道": "hokkaido",
    "青森県": "aomori",
    "岩手県": "iwate",
    "宮城県": "miyagi",
    "秋田県": "akita",
    "山形県": "yamagata",
    "福島県": "fukushima",
    "茨城県": "ibaraki",
    "栃木県": "tochigi",
    "群馬県": "gunma",
    "埼玉県": "saitama",
    "千葉県": "chiba",
    "東京都": "tokyo",
    "神奈川県": "kanagawa",
    "新潟県": "niigata",
    "富山県": "toyama",
    "石川県": "ishikawa",
    "福井県": "fukui",
    "山梨県": "yamanashi",
    "長野県": "nagano",
    "岐阜県": "gifu",
    "静岡県": "shizuoka",
    "愛知県": "aichi",
    "三重県": "mie",
    "滋賀県": "shiga",
    "京都府": "kyoto",
    "大阪府": "osaka",
    "兵庫県": "hyogo",
    "奈良県": "nara",
    "和歌山県": "wakayama",
    "鳥取県": "tottori",
    "島根県": "shimane",
    "岡山県": "okayama",
    "広島県": "hiroshima",
    "山口県": "yamaguchi",
    "徳島県": "tokushima",
    "香川県": "kagawa",
    "愛媛県": "ehime",
    "高知県": "kochi",
    "福岡県": "fukuoka",
    "佐賀県": "saga",
    "長崎県": "nagasaki",
    "熊本県": "kumamoto",
    "大分県": "oita",
    "宮崎県": "miyazaki",
    "鹿児島県": "kagoshima",
    "沖縄県": "okinawa",
}


@dataclass(frozen=True)
class ProxyConfig:
    server: str
    username: str
    password: str
    # ログ用。Google はキーワード単位で固定、Yahoo! は毎回新規。
    session_id: str = ""
    session_mode: str = "random"
    # ログ用。どの経路（google / yahoo）向けに組み立てた設定か。
    platform: str = ""


SOAX_USERNAME_KEYS = ("country", "region", "network", "rotate", "session")


def describe_proxy(proxy: "ProxyConfig") -> str:
    """SOAX に実際に送る username を、読める形で1行にする。

    パスワードは出さない（パッケージ識別はパスワード側なので username に秘密は
    無いが、session だけは先頭4文字を残して伏せる）。network が mob / res の
    どちらか、region が省略されているかを、経路（platform）ごとにログで確認する
    ためのもの。
    """
    tokens = proxy.username.split("-")
    fields: dict[str, str] = {}
    index = 0
    while index + 1 < len(tokens):
        key = tokens[index]
        if key in SOAX_USERNAME_KEYS:
            fields[key] = tokens[index + 1]
            index += 2
        else:
            index += 1
    session = fields.get("session", "")
    masked_session = f"{session[:4]}****" if session else "-"
    masked_username = re.sub(r"(session-)[^-]+", rf"\g<1>{masked_session}", proxy.username)
    return (
        f"platform={proxy.platform or '-'} "
        f"network={fields.get('network') or '-'} "
        f"region={fields.get('region') or '省略'} "
        f"rotate={fields.get('rotate') or '-'} "
        f"country={fields.get('country') or '-'} "
        f"username={masked_username}"
    )


def soax_region_for(prefecture: Optional[str]) -> Optional[str]:
    """regions.prefecture を SOAX の exit 地域名に変換する。"""
    if not prefecture:
        return None
    normalized = prefecture.strip()
    if normalized in PREFECTURE_TO_SOAX_REGION:
        return PREFECTURE_TO_SOAX_REGION[normalized]
    # 「東京」のように接尾辞なしで入っている場合も拾う
    for full, region in PREFECTURE_TO_SOAX_REGION.items():
        if full.startswith(normalized):
            return region
    return None


SOAX_DEFAULT_ENDPOINT = "proxy.soax.com:1337"
SOAX_DEFAULT_COUNTRY = "jp"
SOAX_DEFAULT_NETWORK = "res"
SOAX_DEFAULT_ROTATE_SECONDS = "300"

# session に使える文字と長さ。英数字以外が混ざるとトークン区切りとして壊れる。
_SESSION_ALLOWED = re.compile(r"[^A-Za-z0-9]")
SESSION_ID_MAX_LENGTH = 32


def sanitize_session_id(raw: str) -> str:
    """英数字以外を除去 → 小文字化 → 32文字以内に詰める。"""
    return _SESSION_ALLOWED.sub("", raw).lower()[:SESSION_ID_MAX_LENGTH]


def new_session_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=16))


def soax_region_enabled() -> bool:
    """地域指定を使うか。既定は有効。"""
    value = os.environ.get("SOAX_REGION_ENABLED", "1").strip().lower()
    return value not in ("0", "false", "no", "off")


def build_soax_username(
    *,
    country: str,
    region: Optional[str],
    network: str,
    rotate_seconds: str,
    session_id: str,
) -> str:
    """SOAX のユーザー名（オプション文字列）を組み立てる。

    トークンの区切りは "-" 固定。値に "-" を含められないので、
    session は呼び出し前にサニタイズしておくこと。
    """
    parts: list[str] = []
    if country:
        parts += ["country", country]
    if region:
        parts += ["region", region]
    if network:
        parts += ["network", network]
    if rotate_seconds:
        # rotate-timed_300 で「300秒ごとにローテート」。
        parts += ["rotate", f"timed_{rotate_seconds}"]
    if session_id:
        parts += ["session", session_id]
    return "-".join(parts)


def soax_session_pinned() -> bool:
    """SOAX_SESSION_ID が固定されているか。固定だとリトライしても同じ IP になる。"""
    return bool(os.environ.get("SOAX_SESSION_ID", "").strip())


# --------------------------------------------------------------------------
# Google のセッション固定（BOT 検知の密度対策）
#
# Google は同一キーワードでは SOAX の session を固定し、IP の切り替えは
# rotate-timed_300（5分同一 IP）に任せる。毎リクエストで session を振り直すと
# 5分内に同じ検索が別 IP から連射され（IP flood）、検知の材料になる。
# /sorry/ を掴んだ session は「焼けた」とみなして rotate_google_session で
# 振り直し、以後その session は使わない。Yahoo! はこれまでどおり毎回新規。
# --------------------------------------------------------------------------

_google_session_salt: dict[str, str] = {}


def google_session_id(keyword: str) -> str:
    """同じキーワードなら同じ session（salt が振り直されるまで）。"""
    import hashlib

    salt = _google_session_salt.get(keyword, "")
    digest = hashlib.sha1(f"{keyword}\u0000{salt}".encode("utf-8")).hexdigest()
    return sanitize_session_id(f"g{digest[:15]}")


def rotate_google_session(keyword: str) -> str:
    """そのキーワードの session を完全に振り直し、別 IP プールに移る。"""
    _google_session_salt[keyword] = new_session_id()
    return google_session_id(keyword)


def _env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def build_proxy_config(
    prefecture: Optional[str] = None,
    *,
    platform: Optional[str] = None,
    keyword: Optional[str] = None,
) -> Optional[ProxyConfig]:
    """環境変数から SOAX の設定を組み立てる。SOAX_PASS が無ければ None。

    パッケージの識別はパスワードで行われるため、ユーザー名側には
    オプション文字列だけを入れる（package ID は不要）。

    Google だけ検知されるケースへの対処として、platform="google" のときは
    SOAX_GOOGLE_NETWORK / SOAX_GOOGLE_OMIT_REGION / SOAX_GOOGLE_ROTATE_SECONDS
    で上書きできる。Yahoo! 側の組み立ては影響を受けない。
    """
    password = os.environ.get("SOAX_PASS", "").strip()
    if not password:
        return None

    endpoint = os.environ.get("SOAX_ENDPOINT", "").strip() or SOAX_DEFAULT_ENDPOINT
    country = os.environ.get("SOAX_COUNTRY", SOAX_DEFAULT_COUNTRY).strip()
    network = os.environ.get("SOAX_NETWORK", SOAX_DEFAULT_NETWORK).strip()
    rotate_seconds = os.environ.get(
        "SOAX_ROTATE_SECONDS", SOAX_DEFAULT_ROTATE_SECONDS
    ).strip()

    region = soax_region_for(prefecture) if soax_region_enabled() else None

    if platform == "google":
        # 住宅IPだと Google に弾かれ続けるため、Google だけモバイルプール
        # （network-mob）に逃がせるようにしてある。未設定なら SOAX_NETWORK に従う。
        google_network = os.environ.get("SOAX_GOOGLE_NETWORK", "").strip()
        if google_network:
            network = google_network

        # region 絞りでノード品質が落ちている可能性の切り分け。
        # 地点は geolocation override で決まるので、外しても順位への実害はない。
        if _env_flag("SOAX_GOOGLE_OMIT_REGION"):
            region = None

        google_rotate = os.environ.get("SOAX_GOOGLE_ROTATE_SECONDS", "").strip()
        if google_rotate:
            rotate_seconds = google_rotate

    pinned = os.environ.get("SOAX_SESSION_ID", "").strip()
    if pinned:
        session_id = sanitize_session_id(pinned)
        session_mode = "pinned"
    elif platform == "google" and keyword:
        # Google だけキーワード単位で固定（Yahoo! の経路は従来どおり毎回新規）。
        session_id = google_session_id(keyword)
        session_mode = "keyword"
    else:
        session_id = sanitize_session_id(new_session_id())
        session_mode = "random"

    return ProxyConfig(
        server=endpoint,
        username=build_soax_username(
            country=country,
            region=region,
            network=network,
            rotate_seconds=rotate_seconds,
            session_id=session_id,
        ),
        password=password,
        session_id=session_id,
        session_mode=session_mode,
        platform=platform or "",
    )


# --------------------------------------------------------------------------
# 実行結果
# --------------------------------------------------------------------------


@dataclass
class SearchOutcome:
    """1回の検索の結果。runs に書くのは status と exit_ip だけ。"""

    status: str  # 'ok' | 'blocked' | 'error'
    platform: str = ""
    device: str = ""
    final_url: str = ""
    result_count: int = 0
    exit_ip: Optional[str] = None
    error: Optional[str] = None
    notes: list[str] = field(default_factory=list)
    screenshot_path: Optional[Path] = None
    # 1 = 初回のみ、2 = セッションを変えてリトライした
    attempts: int = 1

    def note(self, message: str) -> None:
        """想定外の挙動を落とさずに残す。"""
        self.notes.append(message)


# --------------------------------------------------------------------------
# ブラウザ context
# --------------------------------------------------------------------------


def find_chrome() -> str:
    """Google Chrome の実バイナリを探す。Chromium では Google を通過できない。"""
    override = os.environ.get("CHROME_PATH", "").strip()
    candidates = [override] if override else []
    candidates += list(WINDOWS_CHROME_PATHS)
    candidates += [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise SearchError(
        "Google Chrome の実バイナリが見つかりません。CHROME_PATH を設定してください。"
    )


# Google 経路だけに足す起動引数（fingerprint 対策）。Yahoo! には付けない。
GOOGLE_EXTRA_BROWSER_ARGS = ("--disable-blink-features=AutomationControlled",)
# --disable-features は Chrome が「最後に指定した1つ」しか見ないので、
# 複数の機能は必ず1つの引数にまとめる（別引数で足すと Translate が消える）。
GOOGLE_EXTRA_DISABLED_FEATURES = ("NetworkServiceIPv6",)


async def start_browser(
    *,
    proxy: Optional[ProxyConfig],
    headless: bool = False,
    platform: Optional[str] = None,
) -> uc.Browser:
    """TZ=Asia/Tokyo・--lang=ja で Google Chrome を起動する。

    platform="google" のときだけ GOOGLE_EXTRA_* を足す。Yahoo! の引数は不変。
    """
    os.environ["TZ"] = TIMEZONE_ID

    disabled_features = ["Translate"]
    if platform == "google":
        disabled_features += list(GOOGLE_EXTRA_DISABLED_FEATURES)

    browser_args = [
        "--lang=ja",
        f"--accept-lang={ACCEPT_LANGUAGE}",
        f"--disable-features={','.join(disabled_features)}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if platform == "google":
        browser_args.extend(GOOGLE_EXTRA_BROWSER_ARGS)
    # コンテナで動かすときの追加オプション（--no-sandbox など）。
    # レシピの必須条件（--lang=ja / Accept-Language / TZ）は上で固定してあるので、
    # ここで足せるのは環境差を吸収するためのものだけ。
    browser_args.extend(
        arg for arg in os.environ.get("CHROME_EXTRA_ARGS", "").split() if arg
    )
    if proxy:
        browser_args.append(f"--proxy-server={proxy.server}")

    reset_stage()
    chrome_path = find_chrome()
    stage(
        "Chrome起動開始",
        f"path={chrome_path} headless={headless} "
        f"proxy={'あり' if proxy else 'なし'} args={' '.join(browser_args)}",
    )
    browser = await uc.start(
        browser_executable_path=chrome_path,
        browser_args=browser_args,
        lang="ja-JP",
        headless=headless,
    )
    stage("Chrome起動完了", f"websocket={getattr(browser, 'websocket_url', '') or '-'}")
    return browser


async def setup_request_interception(tab, proxy: Optional[ProxyConfig]) -> None:
    """画像・メディア・フォントを abort し、必要ならプロキシ認証に応答する。"""
    stage(
        "プロキシ設定",
        (
            f"server={proxy.server} 認証=あり（Fetch.AuthRequired で応答） "
            f"session_mode={proxy.session_mode} {describe_proxy(proxy)}"
            if proxy
            else "プロキシなし（直結。画像・メディア・フォントの遮断のみ）"
        ),
    )

    async def on_request_paused(event: cdp.fetch.RequestPaused, connection) -> None:
        try:
            if event.resource_type in BLOCKED_RESOURCE_TYPES:
                await connection.send(
                    cdp.fetch.fail_request(
                        request_id=event.request_id,
                        error_reason=cdp.network.ErrorReason.BLOCKED_BY_CLIENT,
                    )
                )
            else:
                await connection.send(
                    cdp.fetch.continue_request(request_id=event.request_id)
                )
        except Exception:
            # 既に解決済みのリクエストは continue できない。落とさない。
            pass

    async def on_auth_required(event: cdp.fetch.AuthRequired, connection) -> None:
        assert proxy is not None
        try:
            await connection.send(
                cdp.fetch.continue_with_auth(
                    request_id=event.request_id,
                    auth_challenge_response=cdp.fetch.AuthChallengeResponse(
                        response="ProvideCredentials",
                        username=proxy.username,
                        password=proxy.password,
                    ),
                )
            )
        except Exception:
            pass

    tab.add_handler(cdp.fetch.RequestPaused, on_request_paused)
    if proxy:
        tab.add_handler(cdp.fetch.AuthRequired, on_auth_required)

    # nodriver はハンドラ登録時に Fetch.enable() を引数なしで自動送信するため、
    # handle_auth_requests が落ちてしまう。先に enabled 扱いにしてから自前で送る。
    if cdp.fetch not in tab.enabled_domains:
        tab.enabled_domains.append(cdp.fetch)
    await tab.send(
        cdp.fetch.enable(
            patterns=[cdp.fetch.RequestPattern(url_pattern="*")],
            handle_auth_requests=bool(proxy),
        )
    )


async def apply_device_profile(tab, profile: DeviceProfile) -> None:
    """UA・画面サイズ・タッチ・TZ・Accept-Language を一貫して適用する。"""
    raw = await tab.evaluate(
        """
        (() => {
          const d = navigator.userAgentData;
          return JSON.stringify({
            ua: navigator.userAgent,
            brands: d ? d.brands : [],
          });
        })()
        """,
        return_by_value=True,
    )
    info = json.loads(raw) if isinstance(raw, str) else {"ua": "", "brands": []}
    real_ua: str = info.get("ua", "")

    if profile.mobile:
        android_major = profile.ua_platform_version.split(".")[0]
        user_agent = real_ua.replace(
            "Windows NT 10.0; Win64; x64",
            f"Linux; Android {android_major}; {profile.ua_model}",
        ).replace("Safari/537.36", "Mobile Safari/537.36")
    else:
        user_agent = real_ua

    brands = [
        cdp.emulation.UserAgentBrandVersion(
            brand=str(brand.get("brand", "")), version=str(brand.get("version", ""))
        )
        for brand in info.get("brands", [])
        if brand.get("brand")
    ]

    await tab.send(
        cdp.emulation.set_user_agent_override(
            user_agent=user_agent,
            accept_language=ACCEPT_LANGUAGE,
            platform="Android" if profile.mobile else "Win32",
            user_agent_metadata=cdp.emulation.UserAgentMetadata(
                platform=profile.ua_platform,
                platform_version=profile.ua_platform_version,
                architecture=profile.ua_architecture,
                model=profile.ua_model,
                mobile=profile.mobile,
                brands=brands or None,
            ),
        )
    )
    await tab.send(
        cdp.emulation.set_device_metrics_override(
            width=profile.width,
            height=profile.height,
            device_scale_factor=profile.device_scale_factor,
            mobile=profile.mobile,
            screen_orientation=cdp.emulation.ScreenOrientation(
                type_=profile.orientation, angle=profile.orientation_angle
            ),
        )
    )
    await tab.send(
        cdp.emulation.set_touch_emulation_enabled(
            enabled=profile.mobile, max_touch_points=profile.touch_points or 1
        )
    )
    await tab.send(cdp.emulation.set_timezone_override(timezone_id=TIMEZONE_ID))

    await tab.send(cdp.network.enable())
    await tab.send(
        cdp.network.set_extra_http_headers(
            headers=cdp.network.Headers({"Accept-Language": ACCEPT_LANGUAGE})
        )
    )


# Google の同意画面回避と BOT シグナル削減のための cookie。
# google.com と google.co.jp の両方に CONSENT / SOCS / NID を入れる（計6個）。
# SOCS は同意済みを表す一般的な値。NID は形式だけ合わせたランダム値。
# GOOGLE_PRESET_COOKIES=0 で無効化できる。Yahoo! の経路では呼ばない。
GOOGLE_COOKIE_DOMAINS = (".google.com", ".google.co.jp")
GOOGLE_CONSENT_VALUE = "YES+cb.20240101-01-p0.ja+FX+000"
GOOGLE_SOCS_VALUE = "CAESHAgBEhJnd3NfMjAyMzAzMjgtMF9SQzIaAmVuIAEaBgiA_LyaBg"


def _google_nid_value() -> str:
    alphabet = string.ascii_letters + string.digits + "-_"
    return "511=" + "".join(random.choices(alphabet, k=128))


def google_preset_cookies() -> list[tuple[str, str, str]]:
    """(name, value, domain) の一覧。"""
    nid = _google_nid_value()
    cookies: list[tuple[str, str, str]] = []
    for domain in GOOGLE_COOKIE_DOMAINS:
        cookies.append(("CONSENT", GOOGLE_CONSENT_VALUE, domain))
        cookies.append(("SOCS", GOOGLE_SOCS_VALUE, domain))
        cookies.append(("NID", nid, domain))
    return cookies


async def inject_google_cookies(tab) -> None:
    """Google のトップを開く前に cookie を入れる。失敗しても検索は続ける。"""
    if not _env_flag("GOOGLE_PRESET_COOKIES", "1"):
        stage("Cookie注入", "GOOGLE_PRESET_COOKIES=0 のためスキップ")
        return

    cookies = google_preset_cookies()
    expires = cdp.network.TimeSinceEpoch(time.time() + 180 * 24 * 3600)
    params = [
        cdp.network.CookieParam(
            name=name,
            value=value,
            domain=domain,
            path="/",
            secure=True,
            http_only=(name != "CONSENT"),
            expires=expires,
        )
        for name, value, domain in cookies
    ]
    try:
        await tab.send(cdp.network.set_cookies(cookies=params))
        stage(
            "Cookie注入",
            f"{len(params)} 個（CONSENT / SOCS / NID × {', '.join(GOOGLE_COOKIE_DOMAINS)}）",
        )
    except Exception as caught:  # noqa: BLE001 - 注入できなくても検索は続ける
        print(f"    ! cookie の注入に失敗（続行）: {type(caught).__name__}: {caught}")


async def grant_geolocation(
    browser, tab, origins: Iterable[str], lat: float, lng: float
) -> None:
    """権限付与 → override の順で地点を固定する。順序に意味がある。"""
    stage("geolocation設定", f"lat={lat} lng={lng} origins={', '.join(origins)}")
    for origin in origins:
        try:
            await browser.connection.send(
                cdp.browser.grant_permissions(
                    permissions=[cdp.browser.PermissionType.GEOLOCATION],
                    origin=origin,
                )
            )
        except Exception as caught:  # noqa: BLE001
            # 付与に失敗しても override 自体は効くことがあるので続行する。
            print(
                f"    ! geolocation 権限の付与に失敗（続行）: {origin}: "
                f"{type(caught).__name__}: {caught}"
            )

    await tab.send(
        cdp.emulation.set_geolocation_override(
            latitude=lat, longitude=lng, accuracy=100
        )
    )


# --------------------------------------------------------------------------
# 入力・待機
# --------------------------------------------------------------------------


async def page_diagnostics(tab) -> dict[str, Any]:
    """いま何が表示されているのかを掴むための最小情報。

    検索窓が見つからないとき、同意画面なのか別レイアウトなのか
    /sorry/ の亜種なのか、そもそも描画が終わっていない（body が空）のかを
    ログだけで判別できるようにする。readyState と長さはそのためのもの。
    """
    try:
        raw = await tab.evaluate(
            """
            (() => JSON.stringify({
              url: location.href,
              host: location.host,
              title: document.title || '',
              readyState: document.readyState,
              bodyLength: document.body ? document.body.innerText.length : -1,
              htmlLength: document.documentElement ? document.documentElement.outerHTML.length : -1,
              body: (document.body ? document.body.innerText : '').slice(0, 500)
            }))()
            """,
            return_by_value=True,
        )
        return json.loads(raw) if isinstance(raw, str) else {}
    except Exception:  # noqa: BLE001 - 診断で落とさない
        return {}


def describe_page_state(info: dict[str, Any]) -> str:
    """readyState と body / HTML の長さを1行にする（描画未完了の切り分け用）。"""

    def length(key: str) -> str:
        value = info.get(key, "-")
        # -1 は要素そのものが無い（body がまだ無い＝描画前）ことを表す。
        return "なし" if value == -1 else f"{value} 文字"

    return (
        f"readyState={info.get('readyState') or '-'} "
        f"body={length('bodyLength')} html={length('htmlLength')}"
    )


def format_diagnostics(info: dict[str, Any]) -> list[str]:
    body = " / ".join(
        line.strip() for line in str(info.get("body") or "").splitlines() if line.strip()
    )
    return [
        f"URL   : {str(info.get('url') or '-')[:200]}",
        f"title : {str(info.get('title') or '-')[:200]}",
        f"state : {describe_page_state(info)}",
        f"body  : {body[:500] or '-'}",
    ]


# Google の同意画面で押すボタン。まず id / 属性、だめならテキストで探す。
CONSENT_SELECTORS = (
    "#L2AGLb",
    "button#L2AGLb",
    "form[action*='consent'] button",
    "button[aria-label*='同意']",
    "button[aria-label*='Accept']",
)
CONSENT_TEXTS = (
    "すべて同意",
    "同意する",
    "同意してつづける",
    "Accept all",
    "I agree",
    "Agree to all",
)


async def looks_like_consent(tab) -> bool:
    info = await page_diagnostics(tab)
    host = (info.get("host") or "").lower()
    if "consent." in host:
        return True
    body = info.get("body") or ""
    return any(text in body for text in CONSENT_TEXTS)


async def try_accept_consent(tab) -> Optional[str]:
    """同意画面なら「同意する」を押す。押せたら押したものを返す。

    実際のクリック（マウスイベント）を優先し、だめなら JS クリックに落とす。
    """
    for selector in CONSENT_SELECTORS:
        try:
            element = await tab.select(selector, timeout=1)
        except Exception:  # noqa: BLE001 - 次の候補へ
            continue
        if element is None:
            continue
        try:
            await element.click()
            return selector
        except Exception:  # noqa: BLE001
            continue

    try:
        clicked = await tab.evaluate(
            """
            (() => {
              const texts = """
            + json.dumps(list(CONSENT_TEXTS))
            + """;
              const nodes = document.querySelectorAll(
                "button, div[role=button], input[type=submit], a[role=button]"
              );
              for (const node of nodes) {
                const label = (
                  node.innerText || node.value || node.getAttribute('aria-label') || ''
                ).trim();
                if (!label) continue;
                if (texts.some((t) => label.includes(t))) {
                  node.click();
                  return label.slice(0, 60);
                }
              }
              return null;
            })()
            """,
            return_by_value=True,
        )
        if isinstance(clicked, str) and clicked:
            return f"text:{clicked}"
    except Exception:  # noqa: BLE001
        pass
    return None


async def select_first(tab, selectors: Sequence[str], timeout: float = 15.0):
    """候補セレクタを順に試し、最初に見つかった要素を返す。

    platform × device で DOM が違うため、単一セレクタ決め打ちにはしない。
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    last_error: Optional[Exception] = None

    while loop.time() < deadline:
        for selector in selectors:
            try:
                element = await tab.select(selector, timeout=1)
            except Exception as caught:  # noqa: BLE001 - 次の候補を試す
                last_error = caught
                continue
            if element is not None:
                return element, selector
        await asyncio.sleep(0.3)

    raise SearchError(
        f"要素が見つかりませんでした（候補: {', '.join(selectors)}）: {last_error}"
    )


async def _active_is_one_of(tab, names: Sequence[str]) -> bool:
    try:
        focused = await tab.evaluate(
            "(() => { const a = document.activeElement;"
            f" return !!a && {json.dumps(list(names))}.includes(a.name); }})()",
            return_by_value=True,
        )
        return bool(focused)
    except Exception:
        return False


async def _tap_element(tab, element) -> bool:
    """タッチでタップする。

    モバイル記述子ではマウスクリックだとフォーカスが body に戻されてしまい、
    タイプした文字がどこにも入らない。touch イベントを送る必要がある。
    """
    try:
        position = await element.get_position()
    except Exception:
        return False
    if position is None:
        return False

    try:
        x, y = position.center
    except Exception:
        x, y = getattr(position, "x", None), getattr(position, "y", None)
    if x is None or y is None:
        return False

    point = cdp.input_.TouchPoint(
        x=float(x), y=float(y), radius_x=2.0, radius_y=2.0, force=1.0, id_=0.0
    )
    await tab.send(
        cdp.input_.dispatch_touch_event(type_="touchStart", touch_points=[point])
    )
    await asyncio.sleep(random.uniform(0.05, 0.12))
    await tab.send(cdp.input_.dispatch_touch_event(type_="touchEnd", touch_points=[]))
    return True


# ページ遷移の完了（readyState が interactive / complete）を待つ最大秒数。
READY_STATE_TIMEOUT_SECONDS = 15.0
READY_STATE_POLL_SECONDS = 0.5
# tab.reload() が ProtocolException で失敗したときの再試行回数と待ち。
RELOAD_ATTEMPTS = 3
RELOAD_RETRY_WAIT_SECONDS = (1.0, 1.5, 2.0)


async def wait_for_ready(
    tab, *, label: str, timeout: float = READY_STATE_TIMEOUT_SECONDS
) -> str:
    """document.readyState が interactive / complete になるまで待つ。

    遅い IP だとトップページへの遷移が終わる前に次のコマンド（reload）を
    送ってしまい "Not attached to an active page" になるので、その前に挟む。
    evaluate 自体が失敗しても例外にはせず、短く待って続ける。
    最後に段階マーカーで readyState と待った秒数を出す。
    """
    loop = asyncio.get_running_loop()
    started = loop.time()
    deadline = started + timeout
    state = "unknown"
    while True:
        try:
            value = await tab.evaluate("document.readyState", return_by_value=True)
            state = value if isinstance(value, str) else "unknown"
        except Exception as caught:  # noqa: BLE001 - 遷移中は失敗して当然
            state = f"unknown({type(caught).__name__})"
        if state in ("interactive", "complete") or loop.time() >= deadline:
            break
        await asyncio.sleep(READY_STATE_POLL_SECONDS)
    elapsed = loop.time() - started
    stage(label, f"readyState={state}（{elapsed:.1f} 秒）")
    return state


async def reload_with_retry(tab, url: str) -> None:
    """tab.reload() を防御的に行う。

    ProtocolException（-32000 系）が出たら 1〜2 秒待って最大 RELOAD_ATTEMPTS 回
    やり直し、それでもだめなら同じ URL への tab.get() で代替する。
    """
    last: Optional[BaseException] = None
    for attempt in range(1, RELOAD_ATTEMPTS + 1):
        try:
            await tab.reload()
            if attempt > 1:
                print(f"    リロード成功（{attempt}/{RELOAD_ATTEMPTS} 回目）")
            return
        except ProtocolException as caught:
            last = caught
            wait = RELOAD_RETRY_WAIT_SECONDS[min(attempt, len(RELOAD_RETRY_WAIT_SECONDS)) - 1]
            print(
                f"    ! リロード失敗（{attempt}/{RELOAD_ATTEMPTS}）: "
                f"{type(caught).__name__}: {caught} → {wait:.1f} 秒待って再試行"
            )
            await asyncio.sleep(wait)

    print(f"    ! リロードが {RELOAD_ATTEMPTS} 回失敗したため、同じ URL へ再ナビゲーションします: {url}")
    try:
        await tab.get(url)
    except Exception as caught:  # noqa: BLE001 - ここで落ちたら呼び出し側の except に任せる
        raise caught from last


# 検索窓のセレクタを待つ秒数（初回と、リロード後の再試行でそれぞれこの秒数）。
SEARCH_BOX_TIMEOUT_SECONDS = 20.0
# リロード直後に描画を落ち着かせる秒数。
RELOAD_SETTLE_SECONDS = 1.5


async def _reload_and_wait_for_search_box(tab, selectors: Sequence[str]):
    """同じセッションでリロードしてから、もう一度だけ検索窓を待つ。

    ここでも見つからなければ SearchBoxNotFound を投げ、その先で
    従来どおりの「セッション変更リトライ（1回）」に進む。
    """
    before = await page_diagnostics(tab)
    stage(
        "リロード再試行",
        f"検索窓が {SEARCH_BOX_TIMEOUT_SECONDS:.0f} 秒で見つからず"
        f"（{describe_page_state(before)}）。同じセッションでリロードします",
    )
    try:
        url = await current_url(tab)
        await reload_with_retry(tab, url or "about:blank")
        await tab.sleep(RELOAD_SETTLE_SECONDS)
    except Exception as caught:  # noqa: BLE001 - リロード自体の失敗も待ち直しに回す
        print(f"    ! リロードに失敗（そのまま待ち直します）: {type(caught).__name__}: {caught}")

    after = await page_diagnostics(tab)
    print(f"    リロード後: {describe_page_state(after)}")

    try:
        return await select_first(tab, selectors, timeout=SEARCH_BOX_TIMEOUT_SECONDS)
    except SearchError as caught:
        info = await page_diagnostics(tab)
        stage("検索窓不明", f"候補={', '.join(selectors)}（リロード再試行後も見つからず）")
        print("  ! 検索窓が見つかりません。そのときのページ:")
        for line in format_diagnostics(info):
            print(f"      {line}")
        raise SearchBoxNotFound(str(caught), info) from caught


# browser.stop() 後にプロセス終了を待つ秒数。超えたら kill する。
BROWSER_STOP_TIMEOUT_SECONDS = 8.0
BROWSER_KILL_TIMEOUT_SECONDS = 5.0


async def close_browser(browser, *, context: str = "") -> None:
    """Chrome を確実に終わらせ、プロセスが消えたことを確認してから戻る。

    nodriver の browser.stop() は terminate を送るだけで終了を待たない。
    次の Chrome（セッション変更リトライや次の実行）を起動する前に呼び、
    同時に2つの Chrome が存在する瞬間を作らない（メモリ溢れの対策）。
    """
    proc = getattr(browser, "_process", None)
    pid = getattr(proc, "pid", None) or getattr(browser, "_process_pid", None)
    label = f"Chrome停止{('・' + context) if context else ''}"

    try:
        browser.stop()
    except Exception as caught:  # noqa: BLE001 - 停止処理で落とさない
        print(f"    ! browser.stop() で例外（続行）: {type(caught).__name__}: {caught}")

    if proc is None:
        stage(f"{label}完了", f"pid={pid or '-'}（プロセス情報なし）")
        return

    try:
        await asyncio.wait_for(proc.wait(), timeout=BROWSER_STOP_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        print(
            f"    ! Chrome (pid={pid}) が {BROWSER_STOP_TIMEOUT_SECONDS:.0f} 秒で"
            "終了しないため kill します"
        )
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        except Exception as caught:  # noqa: BLE001
            print(f"    ! kill に失敗: {type(caught).__name__}: {caught}")
        try:
            await asyncio.wait_for(proc.wait(), timeout=BROWSER_KILL_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            stage(f"{label}失敗", f"pid={pid} のプロセスが残っています")
            return

    stage(f"{label}完了", f"pid={pid} returncode={proc.returncode}")


async def focus_search_box(
    tab,
    profile: DeviceProfile,
    selectors: Sequence[str],
    input_names: Sequence[str],
) -> str:
    """検索窓にキー入力が届く状態にし、使ったセレクタを返す。

    フォーカスが入らないままタイプすると、文字がどこにも入らないまま
    Enter を押すことになり not_searched になる。
    """
    try:
        element, selector = await select_first(
            tab, selectors, timeout=SEARCH_BOX_TIMEOUT_SECONDS
        )
        found_how = ""
    except SearchError:
        # Yahoo! トップは body が空のまま（描画未完了）で待ちが切れることがある。
        # セッションを捨てる前に、同じセッションでリロードして待ち直す。
        element, selector = await _reload_and_wait_for_search_box(tab, selectors)
        found_how = "（リロード後）"
    stage("検索窓発見", f"selector={selector}{found_how}")

    if profile.mobile:
        await _tap_element(tab, element)
    else:
        try:
            await element.click()
        except Exception:
            pass
    await tab.sleep(random.uniform(0.3, 0.6))

    if await _active_is_one_of(tab, input_names):
        return selector

    # タップで実体が差し替わることがあるので取り直してから focus する。
    try:
        element, selector = await select_first(tab, selectors, timeout=5)
        await element.focus()
    except Exception:
        pass
    await tab.sleep(0.3)

    if await _active_is_one_of(tab, input_names):
        return selector

    await tab.evaluate(
        f"(document.querySelector({selector!r}) || {{focus(){{}}}}).focus()"
    )
    await tab.sleep(0.3)

    if not await _active_is_one_of(tab, input_names):
        raise SearchError("検索窓にフォーカスできませんでした。")
    return selector


async def typed_value(tab) -> str:
    """実際にフォーカスしている要素の値を読む。

    トップページには同名の入力要素が複数あることがあり、querySelector の
    先頭一致はタイプ先と別物のことがある。activeElement を見るのが確実。
    """
    try:
        value = await tab.evaluate(
            "(() => { const a = document.activeElement;"
            " return a && 'value' in a ? (a.value || '') : ''; })()",
            return_by_value=True,
        )
        return value if isinstance(value, str) else ""
    except Exception:
        return ""


async def type_like_human(tab, text: str) -> None:
    """1文字ずつ 50〜150ms のランダム間隔で打つ。一括挿入は不可。

    挿入は rawKeyDown → char → keyUp の順。keyDown に text を載せる方式は
    デスクトップでは効くがモバイル記述子だと入らない。
    """
    stage("タイプ開始", f"{len(text)} 文字")
    for char in text:
        await tab.send(
            cdp.input_.dispatch_key_event(
                type_="rawKeyDown", key=char, unmodified_text=char
            )
        )
        await tab.send(
            cdp.input_.dispatch_key_event(
                type_="char", text=char, key=char, unmodified_text=char
            )
        )
        await tab.send(
            cdp.input_.dispatch_key_event(type_="keyUp", key=char, unmodified_text=char)
        )
        await asyncio.sleep(random.uniform(0.05, 0.15))


async def press_enter(tab) -> None:
    """Enter は CDP で送る。ライブラリの send_keys 相当では拾われない。"""
    common: dict[str, Any] = dict(
        key="Enter",
        code="Enter",
        windows_virtual_key_code=13,
        native_virtual_key_code=13,
    )
    await tab.send(
        cdp.input_.dispatch_key_event(
            type_="rawKeyDown", text="\r", unmodified_text="\r", **common
        )
    )
    await tab.send(cdp.input_.dispatch_key_event(type_="char", text="\r", **common))
    await tab.send(cdp.input_.dispatch_key_event(type_="keyUp", **common))


async def count_results(tab, selectors: Sequence[str]) -> int:
    """候補セレクタのうち、最初にヒットしたものの件数を返す。"""
    try:
        value = await tab.evaluate(
            "(() => { for (const s of "
            + json.dumps(list(selectors))
            + ") { const n = document.querySelectorAll(s).length;"
            " if (n > 0) return n; } return 0; })()",
            return_by_value=True,
        )
        return int(value) if value is not None else 0
    except Exception:
        return 0


async def wait_for_results(
    tab, selectors: Sequence[str], max_seconds: float = 10.0
) -> int:
    """件数をポーリングし、3回連続で増えなくなるまで待つ。

    1件見つかった時点で抜けると順次描画の途中を掴むので、必ず安定を待つ。
    """
    stage("結果待ち", f"最大 {max_seconds:.0f} 秒 候補={', '.join(selectors)}")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_seconds
    last = 0
    stable = 0

    while loop.time() < deadline:
        count = await count_results(tab, selectors)
        if count > 0 and count == last:
            stable += 1
            if stable >= 3:
                return count
        else:
            stable = 0
        last = count
        await asyncio.sleep(0.4)

    return last


async def current_url(tab) -> str:
    try:
        url = await tab.evaluate("location.href", return_by_value=True)
        return url if isinstance(url, str) else ""
    except Exception:
        return ""


async def read_exit_ip(tab) -> Optional[str]:
    """exit IP を取得する。失敗しても検索自体は続行する。"""
    stage("exit IP取得", EXIT_IP_ENDPOINT)
    try:
        await tab.get(EXIT_IP_ENDPOINT)
        body = await tab.evaluate("document.body.innerText", return_by_value=True)
        if isinstance(body, str):
            return str(json.loads(body).get("ip"))
    except Exception as caught:  # noqa: BLE001
        # プロキシ認証やネットワークの不調はここで最初に見えることが多い。
        print(f"    ! exit IP を取得できません（続行）: {type(caught).__name__}: {caught}")
        return None
    return None


async def capture_screenshot(tab, path: Optional[Path]) -> Optional[Path]:
    """デバッグ用のローカル保存。DB にも Storage にも上げない。"""
    if path is None:
        return None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        await tab.save_screenshot(str(path), format="png", full_page=True)
    except Exception:
        return None
    return path if path.exists() else None
