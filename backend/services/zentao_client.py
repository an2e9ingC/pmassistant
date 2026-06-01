from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import re
from typing import Optional

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


class ZentaoClient:
    def __init__(self):
        self.base_url = settings.ZENTAO_BASE_URL.rstrip("/")
        self._token: Optional[str] = None
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def authenticate(self) -> str:
        client = await self._get_client()
        url = f"{self.base_url}/tokens"
        account = settings.ZENTAO_AUTH_ACCOUNT
        password = settings.ZENTAO_AUTH_PASSWORD
        pw_md5 = hashlib.md5(password.encode()).hexdigest()

        # Try MD5 first (some Zentao versions require it), then raw password
        for attempt, pw in enumerate([pw_md5, password]):
            logger.info(f"Zentao auth request: POST {url} account={account} pw_method={'md5' if attempt==0 else 'raw'}")
            resp = await client.post(url, json={"account": account, "password": pw})
            logger.info(f"Zentao auth response: HTTP {resp.status_code}")
            try:
                data = resp.json()
            except Exception:
                raw = resp.content
                ct = resp.headers.get("content-type", "")
                m = re.search(r"charset=([^\s;]+)", ct)
                enc = m.group(1) if m else "gbk"
                decoded = raw.decode(enc, errors="replace")
                if not decoded.strip():
                    continue
                data = json.loads(decoded)
            if "token" in data:
                self._token = data["token"]
                logger.info(f"Zentao auth successful (method={'md5' if attempt==0 else 'raw'})")
                return self._token
            error_msg = data.get("error", str(data))
            logger.warning(f"Zentao auth attempt {attempt+1} failed: {error_msg}")

        raise RuntimeError(
            f"Zentao auth failed after trying both MD5 and raw password\n"
            f"URL: {url}\n"
            f"Account: {account}"
        )

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        client = await self._get_client()
        headers = kwargs.pop("headers", {})
        if self._token:
            headers["Token"] = self._token

        for attempt in range(3):
            try:
                url = f"{self.base_url}{path}"
                resp = await client.request(method, url, headers=headers, **kwargs)
                # Handle non-UTF-8 responses (e.g. GBK from Chinese Zentao)
                try:
                    data = resp.json()
                except Exception:
                    raw = resp.content
                    ct = resp.headers.get("content-type", "")
                    m = re.search(r"charset=([^\s;]+)", ct)
                    enc = m.group(1) if m else "gbk"
                    try:
                        data = json.loads(raw.decode(enc, errors="replace"))
                    except json.JSONDecodeError:
                        preview = raw[:300].decode(enc, errors="replace")
                        logger.error(f"Zentao non-JSON response: {method} {url} -> HTTP {resp.status_code}, body: {preview}")
                        if not preview.strip():
                            raise RuntimeError(f"Zentao returned empty response (HTTP {resp.status_code}) from {url}. Check ZENTAO_BASE_URL config.")
                        raise RuntimeError(f"Zentao returned non-JSON response (HTTP {resp.status_code}) from {url}: {preview}")

                # v1 quirk: 401 returns HTTP 200 + {"load": "..."}
                if isinstance(data, dict) and "load" in data and data.get("load"):
                    logger.info("Zentao token expired, re-authenticating...")
                    await self.authenticate()
                    headers["Token"] = self._token
                    continue

                if "error" in data and data.get("error"):
                    err = str(data["error"]).lower()
                    if "not found" in err or ("no " in err and " priv" in err):
                        logger.warning(f"Zentao API skipped (no permission): {data['error']}")
                        return {}
                    raise RuntimeError(f"Zentao API error: {data['error']}")

                # DEBUG: log raw response sample (first 500 chars)
                logger.info(f"Zentao response sample ({path}): {str(data)[:500]}")
                return data

            except httpx.RequestError as e:
                if attempt == 2:
                    raise RuntimeError(f"Zentao API unreachable after 3 attempts: {e}")
                logger.warning(f"Zentao request failed (attempt {attempt + 1}/3): {e}")
                await asyncio.sleep(2 ** attempt)

        raise RuntimeError("Zentao API unreachable")

    async def _get_all_pages(self, path: str, params: Optional[dict] = None) -> list:
        if params is None:
            params = {}
        params.setdefault("limit", 100)
        params.setdefault("page", 1)
        all_items = []
        while True:
            resp = await self._request("GET", path, params=params.copy())
            if not resp:
                break
            # Response key varies by endpoint
            key = None
            for candidate in (
                "projects", "products", "users", "executions",
                "tasks", "bugs", "plans", "releases", "stories",
            ):
                if candidate in resp:
                    key = candidate
                    break
            if key is None:
                break
            items = resp.get(key, [])
            if not items:
                break
            all_items.extend(items)
            total = resp.get("total", len(resp.get(key, [])))
            limit = resp.get("limit", len(resp.get(key, [])))
            if params["page"] * limit >= total:
                break
            params["page"] += 1
        return all_items

    # --- Read endpoints ---

    async def get_users(self) -> list:
        return await self._get_all_pages("/users")

    async def get_user(self, account: str) -> dict:
        return await self._request("GET", f"/users/{account}")

    async def get_products(self) -> list:
        return await self._get_all_pages("/products")

    async def get_product(self, product_id: int) -> dict:
        return await self._request("GET", f"/products/{product_id}")

    async def get_programs(self) -> list:
        """Get all product lines (programs). Returns full list, no pagination."""
        resp = await self._request("GET", "/programs")
        return resp.get("programs", [])

    async def get_projects(self, status: Optional[str] = None) -> list:
        params = {}
        if status:
            params["status"] = status
        return await self._get_all_pages("/projects", params)

    async def get_project(self, project_id: int) -> dict:
        return await self._request("GET", f"/projects/{project_id}")

    async def get_executions(self, project_id: Optional[int] = None) -> list:
        params = {}
        if project_id:
            params["project"] = project_id
        return await self._get_all_pages("/executions", params)

    async def get_execution(self, execution_id: int) -> dict:
        return await self._request("GET", f"/executions/{execution_id}")

    async def get_tasks(self, execution_id: int) -> list:
        return await self._get_all_pages(f"/executions/{execution_id}/tasks")

    async def get_task(self, task_id: int) -> dict:
        return await self._request("GET", f"/tasks/{task_id}")

    async def get_product_bugs(self, product_id: int, status: Optional[str] = None) -> list:
        params = {}
        if status:
            params["status"] = status
        return await self._get_all_pages(f"/products/{product_id}/bugs", params)

    async def get_product_stories(self, product_id: int) -> list:
        return await self._get_all_pages(f"/products/{product_id}/stories")

    async def get_product_releases(self, product_id: int) -> list:
        return await self._get_all_pages(f"/products/{product_id}/releases")

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
