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
import random
import re
import string
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

import nodriver as uc
from nodriver import cdp

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


def build_proxy_config(prefecture: Optional[str] = None) -> Optional[ProxyConfig]:
    """環境変数から SOAX の設定を組み立てる。SOAX_PASS が無ければ None。

    パッケージの識別はパスワードで行われるため、ユーザー名側には
    オプション文字列だけを入れる（package ID は不要）。
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

    raw_session = os.environ.get("SOAX_SESSION_ID", "").strip() or new_session_id()
    session_id = sanitize_session_id(raw_session)

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


async def start_browser(
    *, proxy: Optional[ProxyConfig], headless: bool = False
) -> uc.Browser:
    """TZ=Asia/Tokyo・--lang=ja で Google Chrome を起動する。"""
    os.environ["TZ"] = TIMEZONE_ID

    browser_args = [
        "--lang=ja",
        f"--accept-lang={ACCEPT_LANGUAGE}",
        "--disable-features=Translate",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    # コンテナで動かすときの追加オプション（--no-sandbox など）。
    # レシピの必須条件（--lang=ja / Accept-Language / TZ）は上で固定してあるので、
    # ここで足せるのは環境差を吸収するためのものだけ。
    browser_args.extend(
        arg for arg in os.environ.get("CHROME_EXTRA_ARGS", "").split() if arg
    )
    if proxy:
        browser_args.append(f"--proxy-server={proxy.server}")

    return await uc.start(
        browser_executable_path=find_chrome(),
        browser_args=browser_args,
        lang="ja-JP",
        headless=headless,
    )


async def setup_request_interception(tab, proxy: Optional[ProxyConfig]) -> None:
    """画像・メディア・フォントを abort し、必要ならプロキシ認証に応答する。"""

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


async def grant_geolocation(
    browser, tab, origins: Iterable[str], lat: float, lng: float
) -> None:
    """権限付与 → override の順で地点を固定する。順序に意味がある。"""
    for origin in origins:
        try:
            await browser.connection.send(
                cdp.browser.grant_permissions(
                    permissions=[cdp.browser.PermissionType.GEOLOCATION],
                    origin=origin,
                )
            )
        except Exception:
            # 付与に失敗しても override 自体は効くことがあるので続行する。
            pass

    await tab.send(
        cdp.emulation.set_geolocation_override(
            latitude=lat, longitude=lng, accuracy=100
        )
    )


# --------------------------------------------------------------------------
# 入力・待機
# --------------------------------------------------------------------------


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
    element, selector = await select_first(tab, selectors, timeout=20)

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
    try:
        await tab.get(EXIT_IP_ENDPOINT)
        body = await tab.evaluate("document.body.innerText", return_by_value=True)
        if isinstance(body, str):
            return str(json.loads(body).get("ip"))
    except Exception:
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
