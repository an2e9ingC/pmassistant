"""Document online preview — fetch and serve files from external sources."""

import logging
import re
from typing import Optional, Tuple
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from backend.config import settings
from backend.database import SessionLocal
from backend.models.local import LocalUser
from jose import jwt

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Allowed file extensions for preview
ALLOWED_EXTENSIONS = {
    "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp",
    "md", "txt", "docx",
}

# Content-Type mapping based on file extension
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "svg": "image/svg+xml",
    "webp": "image/webp",
    "md": "text/plain; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# GitLab file URL patterns:
# https://gitlab.example.com/group/project/-/blob/main/path/to/file.pdf
# https://gitlab.example.com/group/project/-/raw/main/path/to/file.pdf
GITLAB_BLOB_RE = re.compile(r"^/(.+?)/-/blob/([^/]+)/(.+)$")
GITLAB_RAW_RE = re.compile(r"^/(.+?)/-/raw/([^/]+)/(.+)$")


def _get_ext(path: str) -> str:
    """Extract lowercase file extension from a path."""
    path = path.split("?")[0].split("#")[0]  # strip query/fragment
    if "." in path:
        return path.rsplit(".", 1)[-1].lower()
    return ""


def _fetch_smb(url: str) -> bytes:
    """Fetch a file from an SMB/CIFS share (UNC path like \\\\host\\share\\path).
    Uses NAS credentials from settings.
    """
    # Parse UNC path: \\host\share\path\to\file
    clean = url.replace("\\\\", "").replace("//", "")
    parts = clean.split("\\")
    # Also handle forward slashes in mixed paths
    if len(parts) == 1:
        parts = clean.split("/")
    if len(parts) < 3:
        raise ValueError("无效的 NAS 路径格式")

    host = parts[0]
    share = parts[1]
    file_path = "/".join(parts[2:])

    nas_user = os.environ.get("NAS_USERNAME", "")
    nas_pass = os.environ.get("NAS_PASSWORD", "")

    if not nas_user:
        raise HTTPException(status_code=502, detail="NAS 用户名未配置")

    from smb.SMBConnection import SMBConnection
    from smb.base import NotConnectedError

    conn = None
    for port in (139, 445):
        try:
            conn = SMBConnection(nas_user, nas_pass, "pma", host, use_ntlm_v2=True)
            conn.connect(host, port)
            break
        except (NotConnectedError, ConnectionError, OSError):
            if conn:
                conn.close()
                conn = None
            continue

    if conn is None:
        raise RuntimeError(f"无法连接到 NAS 服务器 {host} (端口 139/445 均不通)")

    # Read file via temp file (pysmb's retrieveFile doesn't return bytes directly)
    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".smb")
    try:
        tmp.close()
        conn.retrieveFile(share, file_path, open(tmp.name, "wb"))
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        import os as _os
        _os.unlink(tmp.name)
        conn.close()


import os

def _parse_gitlab_url(url: str) -> Optional[Tuple[str, str, str]]:
    """Parse a GitLab file URL into (project_path, file_path, ref).
    Returns None if the URL is not a valid GitLab file URL.
    """
    gitlab_host = urlparse(settings.GITLAB_BASE_URL).netloc
    parsed = urlparse(url)

    if parsed.netloc != gitlab_host:
        return None

    path = unquote(parsed.path)

    # Try /-/raw/... first (direct raw access)
    m = GITLAB_RAW_RE.match(path)
    if m:
        return m.group(1), m.group(3), m.group(2)

    # Then /-/blob/...
    m = GITLAB_BLOB_RE.match(path)
    if m:
        return m.group(1), m.group(3), m.group(2)

    return None


@router.get("/fetch")
async def fetch_document(
    url: str = Query(..., description="Document URL"),
    token: str = Query(None, description="JWT token (for iframe/img that cannot set Authorization header)"),
):
    """Fetch and serve a document from an external source for preview.
    Auth via Bearer header or ?token= query param (for iframe/img tags)."""
    from fastapi import Request
    from backend.middleware.auth import get_current_user
    from backend.database import SessionLocal

    # Auth: try query param token first, then Bearer header
    user_id = None
    if token:
        try:
            payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            user_id = int(payload.get("sub", 0))
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Verify user exists and is active
    db = SessionLocal()
    try:
        user = db.query(LocalUser).filter(LocalUser.id == user_id, LocalUser.is_active == True).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found or inactive")
    finally:
        db.close()

    decoded_url = unquote(url)
    ext = _get_ext(decoded_url)

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持预览 .{ext} 文件类型")

    content_type = CONTENT_TYPES.get(ext, "application/octet-stream")
    content = None

    # Try GitLab first
    gitlab_info = _parse_gitlab_url(decoded_url)
    if gitlab_info:
        project_path, file_path, ref = gitlab_info
        from backend.services.gitlab_client import GitLabClient

        client = GitLabClient()
        try:
            content = await client.get_raw_file(project_path, file_path, ref)
        except Exception:
            pass  # Fall through to direct fetch
        finally:
            await client.close()

        if content is not None:
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=413, detail="文件超过50MB限制")
            return Response(content=content, media_type=content_type)

    # NAS/SMB fetch for UNC paths (\\host\share\...)
    if decoded_url.startswith("\\\\") or decoded_url.startswith("//"):
        try:
            content = _fetch_smb(decoded_url)
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            logger.error(f"SMB fetch failed for {decoded_url}: {e}\n{traceback.format_exc()}")
            raise HTTPException(status_code=502, detail=f"NAS 文件读取失败: {e}")

        if content is not None:
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(status_code=413, detail="文件超过50MB限制")
            return Response(content=content, media_type=content_type)

    # Direct HTTP fetch for other URLs
    try:
        import httpx

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as http_client:
            resp = await http_client.get(decoded_url)
            if resp.status_code == 200:
                content = resp.content
                if len(content) > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="文件超过50MB限制")
                return Response(content=content, media_type=content_type)
            else:
                raise HTTPException(status_code=502, detail=f"无法获取文件 (HTTP {resp.status_code})")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="无法连接文件服务器")
