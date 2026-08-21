"""Document online preview — fetch and serve files from external sources."""

import hashlib
import logging
import os
import re
from typing import Optional, Tuple
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from backend.config import settings
from backend.database import SessionLocal, get_db
from backend.middleware.auth import get_current_user
from backend.models.local import LocalUser
from jose import jwt

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Allowed file extensions for preview
ALLOWED_EXTENSIONS = {
    "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp",
    "md", "txt", "docx", "vsdx",
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
    "vsdx": "application/vnd.ms-visio.drawing",
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# ── Content-hash-based PDF conversion cache ──
# data/ is volume-mounted in Docker; cache survives container restarts
CACHE_DIR = os.path.join("data", "cache", "converted")
_CACHE_MAX_SIZE_DEFAULT_MB = 1024  # default 1024MB


def _get_cache_max_bytes() -> int:
    """Read CONVERT_CACHE_MAX_SIZE_MB env var; 0 = unlimited."""
    try:
        mb = int(os.environ.get("CONVERT_CACHE_MAX_SIZE_MB", str(_CACHE_MAX_SIZE_DEFAULT_MB)))
    except ValueError:
        mb = _CACHE_MAX_SIZE_DEFAULT_MB
    return mb * 1024 * 1024 if mb > 0 else 0


def _content_hash(content: bytes) -> str:
    """Return first 16 hex chars of sha256 digest — cache filename."""
    return hashlib.sha256(content).hexdigest()[:16]


def _read_cache(hash_16: str) -> Optional[bytes]:
    """Read cached PDF by content hash. Touch atime on hit (for LRU eviction)."""
    path = os.path.join(CACHE_DIR, f"{hash_16}.pdf")
    if os.path.exists(path):
        os.utime(path)  # bump atime → kept longer by LRU
        with open(path, "rb") as f:
            return f.read()
    return None


def _write_cache(hash_16: str, pdf_bytes: bytes) -> None:
    """Write PDF to cache, then evict oldest files if over limit."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{hash_16}.pdf")
    with open(path, "wb") as f:
        f.write(pdf_bytes)
    _evict_cache_if_needed()


def _evict_cache_if_needed() -> None:
    """LRU eviction: if total cache size > limit, delete oldest-by-atime files."""
    max_bytes = _get_cache_max_bytes()
    if max_bytes <= 0:
        return
    files = []  # list of (atime, size, path)
    total = 0
    try:
        for name in os.listdir(CACHE_DIR):
            if name.endswith(".pdf"):
                fp = os.path.join(CACHE_DIR, name)
                st = os.stat(fp)
                files.append((st.st_atime, st.st_size, fp))
                total += st.st_size
    except FileNotFoundError:
        return
    if total <= max_bytes:
        return
    files.sort(key=lambda x: x[0])  # oldest atime first
    for _, size, fp in files:
        if total <= max_bytes:
            break
        try:
            os.remove(fp)
            total -= size
        except OSError:
            pass


# ── Conversion helpers ──


def _extract_ole_embedded(content: bytes) -> bytes:
    """Extract OLE-embedded VSDX/DOCX from ZIP container.
    Some Visio files wrap the actual drawing as an OLE ForeignType=Object,
    stored under visio/embeddings/ or word/embeddings/ in the ZIP structure.
    Returns the embedded content if found, otherwise the original content."""
    import zipfile, io
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            candidates = []
            for name in zf.namelist():
                low = name.lower()
                if low.endswith(('.vsdx', '.docx')) and 'embeddings' in low:
                    candidates.append((zf.getinfo(name).file_size, name))
            if candidates:
                candidates.sort(reverse=True)  # pick the largest embedded file
                size, name = candidates[0]
                embedded = zf.read(name)
                logger.info(
                    f"Extracted OLE-embedded {name.split('.')[-1]} "
                    f"({len(embedded)} bytes) from {name}"
                )
                return embedded
    except Exception:
        pass
    return content


def _convert_with_libreoffice(content: bytes, ext: str) -> Optional[bytes]:
    """Convert docx/vsdx → PDF via LibreOffice headless. Returns PDF bytes or None."""
    import tempfile, subprocess, shutil
    tmpdir = tempfile.mkdtemp(prefix="pma-lo-")
    # 独立 user profile：避免与用户 GUI LibreOffice 实例/全局锁（~/.config/libreoffice/4/.lock）冲突，
    # 否则 headless 转换会失败（rc=77 "Failed to update .../lastsynchronized"）
    profile = os.path.join(tmpdir, "profile")
    os.makedirs(profile, exist_ok=True)
    src = os.path.join(tmpdir, f"input.{ext}")
    try:
        with open(src, "wb") as f:
            f.write(content)
        proc = subprocess.run(
            ["libreoffice", "--headless", "-env:UserInstallation=file://" + profile,
             "--convert-to", "pdf", "--outdir", tmpdir, src],
            timeout=60, capture_output=True, text=True,
        )
        pdf = os.path.join(tmpdir, "input.pdf")
        if proc.returncode == 0 and os.path.exists(pdf) and os.path.getsize(pdf) >= 3000:
            with open(pdf, "rb") as f:
                return f.read()
        logger.warning(f"LibreOffice {ext}→pdf failed: rc={proc.returncode} stderr={proc.stderr[:300]}")
        return None
    except subprocess.TimeoutExpired:
        logger.warning(f"LibreOffice {ext}→pdf timed out (60s)")
        return None
    except Exception as e:
        logger.warning(f"LibreOffice {ext}→pdf error: {e}")
        return None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _convert_vsdx_with_drawio(content: bytes) -> Optional[bytes]:
    """Convert VSDX → PDF via draw.io AppImage (headless, xvfb-run).
    Returns PDF bytes on success, None on failure (caller falls back to LibreOffice).
    OLE extraction is handled by _extract_ole_embedded() before this is called."""
    import tempfile, subprocess, shutil

    drawio_bin = "/opt/drawio.AppImage"
    if not os.path.exists(drawio_bin):
        logger.warning("draw.io AppImage not found, will fall back to LibreOffice")
        return None

    tmpdir = tempfile.mkdtemp(prefix="pma-drawio-")
    vsdx_path = os.path.join(tmpdir, "input.vsdx")
    pdf_path = os.path.join(tmpdir, "output.pdf")
    try:
        with open(vsdx_path, "wb") as f:
            f.write(content)
        proc = subprocess.run(
            ["xvfb-run", "-a", drawio_bin,
             "--no-sandbox", "--disable-gpu", "--disable-update",
             "--export", "--format", "pdf", "--crop",
             "--output", pdf_path, vsdx_path],
            timeout=120, capture_output=True, text=True,
        )
        if proc.returncode == 0 and os.path.exists(pdf_path) and os.path.getsize(pdf_path) >= 3000:
            with open(pdf_path, "rb") as f:
                return f.read()
        logger.warning(f"draw.io vsdx→pdf failed: rc={proc.returncode} stderr={proc.stderr[:200]}")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("draw.io conversion timed out (120s)")
        return None
    except Exception as e:
        logger.warning(f"draw.io conversion error: {e}")
        return None
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _build_fallback_html(original_url: str, ext: str) -> str:
    """Build a degraded-mode HTML page when all converters fail."""
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}}
.card{{background:#fff;border-radius:8px;padding:32px;max-width:480px;text-align:center;
box-shadow:0 2px 12px rgba(0,0,0,.1)}}
.icon{{font-size:48px;margin-bottom:16px}}
.title{{font-size:16px;font-weight:600;color:#333;margin-bottom:8px}}
.desc{{font-size:13px;color:#888;margin-bottom:20px;line-height:1.6}}
.btn{{display:inline-block;padding:8px 20px;background:#1677ff;color:#fff;border-radius:6px;
text-decoration:none;font-size:13px}}
</style></head><body>
<div class="card">
<div class="icon">&#x26A0;&#xFE0F;</div>
<div class="title">文档预览转换失败</div>
<div class="desc">系统无法将该 .{ext} 文档转换为 PDF 预览格式。<br>
请下载原始文件后使用本地 Visio/Word 软件查看。</div>
<a class="btn" href="/api/documents/fetch?url={original_url}" download>下载原始文件</a>
</div></body></html>"""

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
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"[doc-fetch] GitLab raw file fetch failed ({e}), falling back to direct HTTP")
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
        import httpx, os, base64

        # Add Basic Auth for SVN/PDM server URLs (auto-detect by URL prefix)
        headers = {}
        svn_base = os.environ.get("SVN_BASE_URL", "")
        svn_user = os.environ.get("SVN_USERNAME", "")
        svn_pass = os.environ.get("SVN_PASSWORD", "")
        pdm_base = os.environ.get("PDM_BASE_URL", "")
        pdm_user = os.environ.get("PDM_USERNAME", "")
        pdm_pass = os.environ.get("PDM_PASSWORD", "")
        if svn_user and svn_pass and svn_base and decoded_url.startswith(svn_base.rstrip("/")):
            cred = base64.b64encode(f"{svn_user}:{svn_pass}".encode()).decode()
            headers["Authorization"] = f"Basic {cred}"
        elif pdm_user and pdm_pass and pdm_base and decoded_url.startswith(pdm_base.rstrip("/")):
            cred = base64.b64encode(f"{pdm_user}:{pdm_pass}".encode()).decode()
            headers["Authorization"] = f"Basic {cred}"

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as http_client:
            resp = await http_client.get(decoded_url, headers=headers)
            if resp.status_code == 200:
                content = resp.content
                if len(content) > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="文件超过50MB限制")

                # Convert docx/vsdx → PDF with content-hash cache
                if ext in ("docx", "vsdx"):
                    # Extract OLE-embedded VSDX/DOCX before hashing (outer file may
                    # just be a container wrapping an embedded drawing).
                    convert_content = _extract_ole_embedded(content) if ext == "vsdx" else content
                    ch = _content_hash(convert_content)
                    cached = _read_cache(ch)
                    if cached is not None:
                        content = cached
                        content_type = "application/pdf"
                    else:
                        pdf_bytes = None
                        if ext == "vsdx":
                            pdf_bytes = _convert_vsdx_with_drawio(convert_content)
                            if pdf_bytes is None:
                                logger.info("draw.io unavailable, falling back to LibreOffice for .vsdx")
                                pdf_bytes = _convert_with_libreoffice(convert_content, ext)
                        else:  # docx
                            pdf_bytes = _convert_with_libreoffice(convert_content, ext)

                        if pdf_bytes is not None:
                            _write_cache(ch, pdf_bytes)
                            content = pdf_bytes
                            content_type = "application/pdf"
                        else:
                            # All converters failed → degraded HTML page
                            return Response(
                                content=_build_fallback_html(decoded_url, ext),
                                media_type="text/html; charset=utf-8",
                            )

                return Response(content=content, media_type=content_type)
            else:
                raise HTTPException(status_code=502, detail=f"无法获取文件 (HTTP {resp.status_code})")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="无法连接文件服务器")


@router.post("/projects/{project_id}/docs/check")
async def check_project_docs_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Manually trigger project document scan for one project."""
    from backend.services.doc_scanner import check_project_docs
    result = await check_project_docs(db, project_id)
    from backend.routers.logs import log_audit
    from backend.audit_categories import AUDIT_CAT_PROJECT
    log_audit(db, user, "project_doc_scan", f"项目ID={project_id} 匹配数={result.get('total_matched',0)}", AUDIT_CAT_PROJECT, "low")
    return {"code": 0, "data": result, "message": f"已扫描 {result.get('scanned', 0)} 个文档，匹配 {result.get('total_matched', 0)} 个"}
