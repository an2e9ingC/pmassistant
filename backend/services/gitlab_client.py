"""GitLab API v4 async client (read-only, GitLab 15.2 compatible).

Used for:
- Connection health check (GET /api/v4/version)
- Release validation (GET /api/v4/projects/:id/releases/:tag_name)
- Repository file listing (GET /api/v4/projects/:id/repository/tree)

All methods are read-only; no create/update/delete operations.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional
from urllib.parse import quote

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


class GitLabClient:
    """Lightweight async GitLab API v4 client for PMA read-only integration."""

    def __init__(self):
        self.base_url = settings.GITLAB_BASE_URL.rstrip("/")
        self._token = settings.GITLAB_TOKEN
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=15.0,
                headers={"PRIVATE-TOKEN": self._token},
            )
        return self._client

    async def _request(self, method: str, path: str, **kwargs) -> dict | list | None:
        """Send a GitLab API request with retry and rate-limit handling."""
        client = await self._get_client()
        url = f"{self.base_url}{path}"

        for attempt in range(3):
            try:
                resp = await client.request(method, url, **kwargs)

                if resp.status_code == 204:
                    return None
                if resp.status_code == 401:
                    raise RuntimeError("GitLab token 无效或已过期，请检查 GITLAB_TOKEN 配置")
                if resp.status_code == 403:
                    raise RuntimeError("GitLab token 权限不足，需要 read_api 权限")
                if resp.status_code == 404:
                    logger.debug(f"GitLab resource not found: {url}")
                    return None
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 5))
                    logger.warning(f"GitLab rate limited, waiting {retry_after}s")
                    await asyncio.sleep(retry_after)
                    continue
                resp.raise_for_status()
                return resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None

            except httpx.RequestError as e:
                if attempt == 2:
                    raise RuntimeError(f"GitLab API 请求失败 (3次重试): {e}")
                logger.warning(f"GitLab request retry {attempt + 1}/3: {e}")
                await asyncio.sleep(2 ** attempt)

        raise RuntimeError("GitLab API 请求失败")

    async def _get_all_pages(self, path: str, params: dict = None) -> list:
        """Fetch all pages for a list endpoint."""
        if params is None:
            params = {}
        params.setdefault("per_page", 100)
        params.setdefault("page", 1)
        all_items = []

        while True:
            resp = await self._request("GET", path, params=params.copy())
            if not resp or not isinstance(resp, list) or len(resp) == 0:
                break
            all_items.extend(resp)
            if len(resp) < params["per_page"]:
                break
            params["page"] += 1

        return all_items

    # ── Health / Version ──

    async def get_version(self) -> dict | None:
        """Get GitLab instance version info. Returns None if unreachable."""
        try:
            return await self._request("GET", "/version")
        except Exception as e:
            logger.warning(f"GitLab version check failed: {e}")
            return None

    async def check_connection(self) -> tuple[bool, str]:
        """Check if GitLab is reachable and token is valid.
        Returns (ok: bool, detail: str).
        """
        if not self._token:
            return False, "未配置Token"
        try:
            ver = await self.get_version()
            if ver and "version" in ver:
                return True, f"GitLab {ver['version']}"
            return False, "无法获取版本信息"
        except RuntimeError as e:
            msg = str(e)
            if "401" in msg or "token" in msg.lower():
                return False, "Token无效"
            if "403" in msg:
                return False, "Token权限不足"
            return False, msg[:50]
        except Exception as e:
            return False, str(e)[:50]

    # ── Projects ──

    async def get_project(self, project_id: int | str) -> dict | None:
        """Get a single GitLab project by ID or URL-encoded path."""
        pid = quote(str(project_id), safe="")
        return await self._request("GET", f"/projects/{pid}")

    async def search_projects(self, search: str, per_page: int = 20) -> list:
        """Search GitLab projects by name/path."""
        return await self._get_all_pages("/projects", {
            "search": search, "simple": True, "per_page": per_page,
        })

    # ── Releases ──

    async def get_releases(self, project_id: int | str) -> list:
        """Get all releases for a GitLab project."""
        pid = quote(str(project_id), safe="")
        return await self._get_all_pages(f"/projects/{pid}/releases")

    async def get_release(self, project_path: str, tag_name: str) -> dict | None:
        """Get a specific release by project path and tag name.
        Args:
            project_path: URL-encoded GitLab project path, e.g. 'rd%2Fproduct'
            tag_name: release tag name, e.g. 'v1.0.0'
        Returns the release dict, or None if not found.
        """
        pid = quote(project_path, safe="")
        tag = quote(tag_name, safe="")
        return await self._request("GET", f"/projects/{pid}/releases/{tag}")

    async def release_exists(self, project_path: str, tag_name: str) -> bool:
        """Check if a GitLab release exists (returns True/False)."""
        result = await self.get_release(project_path, tag_name)
        return result is not None

    # ── Tags ──

    async def get_tag(self, project_path: str, tag_name: str) -> dict | None:
        """Get a specific tag by project path and tag name."""
        pid = quote(project_path, safe="")
        tag = quote(tag_name, safe="")
        return await self._request("GET", f"/projects/{pid}/repository/tags/{tag}")

    async def tag_exists(self, project_path: str, tag_name: str) -> bool:
        """Check if a GitLab tag exists (fallback if no release is created)."""
        result = await self.get_tag(project_path, tag_name)
        return result is not None

    # ── Issues ──

    async def get_last_committer(self, project_path: str) -> dict | None:
        """Get the author of the most recent commit on the default branch."""
        pid = quote(project_path, safe="")
        commits = await self._request("GET", f"/projects/{pid}/repository/commits", params={
            "per_page": 1, "first_parent": "true",
        })
        if commits and isinstance(commits, list) and len(commits) > 0:
            c = commits[0]
            return {
                "name": c.get("author_name", ""),
                "email": c.get("author_email", ""),
            }
        return None

    async def create_issue(
        self, project_path: str, title: str,
        description: str = "", labels: str = "",
    ) -> dict | None:
        """Create a new issue in a GitLab project."""
        pid = quote(project_path, safe="")
        data = {"title": title, "description": description}
        if labels:
            data["labels"] = labels
        return await self._request("POST", f"/projects/{pid}/issues", json=data)

    async def get_issue(
        self, project_path: str, issue_iid: int,
    ) -> dict | None:
        """Get a single issue by IID (project-internal ID, not global ID)."""
        pid = quote(project_path, safe="")
        return await self._request("GET", f"/projects/{pid}/issues/{issue_iid}")

    # ── Members ──

    async def get_members(self, project_path: str) -> list:
        """Get all members of a GitLab project (including inherited group members)."""
        pid = quote(project_path, safe="")
        # /members/all includes members inherited from parent groups
        return await self._get_all_pages(f"/projects/{pid}/members/all")

    # ── Repository files ──

    async def get_tree(
        self, project_path: str,
        path: str = "", ref: str = "main", recursive: bool = False,
    ) -> list:
        """Get repository directory tree."""
        pid = quote(project_path, safe="")
        params = {"ref": ref, "recursive": str(recursive).lower()}
        if path:
            params["path"] = path
        return await self._get_all_pages(f"/projects/{pid}/repository/tree", params)

    async def get_raw_file(self, project_path: str, file_path: str, ref: str = "main") -> bytes | None:
        """Get raw file content."""
        client = await self._get_client()
        pid = quote(project_path, safe="")
        fp = quote(file_path, safe="")
        url = f"{self.base_url}/projects/{pid}/repository/files/{fp}/raw"
        resp = await client.get(url, params={"ref": ref})
        if resp.status_code == 200:
            return resp.content
        return None

    # ── OAuth 2.0 ──

    @property
    def _gitlab_root_url(self) -> str:
        """Derive GitLab root URL from the API base URL.
        e.g. http://192.168.0.128/api/v4 -> http://192.168.0.128
        """
        return self.base_url.rsplit("/api", 1)[0]

    async def exchange_code_for_token(self, code: str, redirect_uri: str) -> dict:
        """Exchange OAuth authorization code for an access token.

        POST {gitlab}/oauth/token with client_id, client_secret, code, grant_type, redirect_uri.
        Returns the token response dict: {access_token, token_type, refresh_token, scope, created_at}.
        """
        from backend.config import settings as current_settings

        url = f"{self._gitlab_root_url}/oauth/token"
        data = {
            "client_id": current_settings.GITLAB_APP_ID,
            "client_secret": current_settings.GITLAB_APP_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }

        client = await self._get_client()
        # OAuth token endpoint uses form data, NOT the PRIVATE-TOKEN header
        try:
            resp = await client.post(url, data=data)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 400:
                error_detail = ""
                try:
                    error_detail = resp.json().get("error_description", resp.text)
                except Exception:
                    error_detail = resp.text
                raise RuntimeError(f"GitLab OAuth token exchange failed: {error_detail}")
            resp.raise_for_status()
            return resp.json()
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"GitLab OAuth token exchange failed: {e}")

    async def get_oauth_user(self, access_token: str) -> dict:
        """Get GitLab user info using an OAuth access token (Bearer auth).

        GET {gitlab}/api/v4/user with Authorization: Bearer {access_token}.
        Returns the GitLab user dict: {id, username, name, email, state, ...}.
        """
        url = f"{self.base_url}/user"
        headers = {"Authorization": f"Bearer {access_token}"}

        client = await self._get_client()
        try:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 401:
                raise RuntimeError("GitLab OAuth access token is invalid or expired")
            resp.raise_for_status()
            return resp.json()
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"GitLab OAuth user fetch failed: {e}")

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
