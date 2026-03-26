from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright


@dataclass
class PlaywrightVPSConfig:
    headless: bool = True
    timeout_ms: int = 30000
    viewport_width: int = 1280
    viewport_height: int = 720
    locale: str = "pt-BR"
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    browser_args: list[str] = field(
        default_factory=lambda: [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
        ]
    )
    extra_http_headers: Dict[str, str] = field(
        default_factory=lambda: {
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
        }
    )
    record_video_dir: Optional[str] = None


class PlaywrightVPSClient:
    def __init__(self, config: Optional[PlaywrightVPSConfig] = None):
        self.config = config or PlaywrightVPSConfig()
        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    def start(self) -> Page:
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(
            headless=self.config.headless,
            args=self.config.browser_args,
        )

        context_args = {
            "viewport": {
                "width": self.config.viewport_width,
                "height": self.config.viewport_height,
            },
            "user_agent": self.config.user_agent,
            "locale": self.config.locale,
            "extra_http_headers": self.config.extra_http_headers,
        }
        if self.config.record_video_dir:
            context_args["record_video_dir"] = self.config.record_video_dir

        self.context = self.browser.new_context(**context_args)
        self.page = self.context.new_page()
        self.page.set_default_timeout(self.config.timeout_ms)
        self.page.set_default_navigation_timeout(self.config.timeout_ms)
        self._apply_basic_stealth()
        return self.page

    def stop(self) -> None:
        if self.context:
            self.context.close()
            self.context = None
        if self.browser:
            self.browser.close()
            self.browser = None
        if self.playwright:
            self.playwright.stop()
            self.playwright = None
        self.page = None

    def _apply_basic_stealth(self) -> None:
        if not self.page:
            return
        self.page.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
            """
        )

    def __enter__(self) -> "PlaywrightVPSClient":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.stop()
        return False
