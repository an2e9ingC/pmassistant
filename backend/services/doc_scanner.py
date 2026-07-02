"""Product document auto-scanner — checks if files exist at template-defined paths.

Parses doc_path patterns with wildcards (*, ?), scans target directories via HTTP,
and auto-marks documents as submitted when matching files are found (size > 0).
"""
import re
import logging
from urllib.parse import urljoin, urlparse
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

# Timeout for HTTP requests (seconds)
HTTP_TIMEOUT = 10


def _glob_to_regex(pattern: str) -> str:
    """Convert a shell-style glob pattern to a regex pattern.
    *  → .*  (any sequence)
    ?  → .   (any single char)
    """
    # Escape regex special chars except * and ?
    escaped = re.escape(pattern)
    # Unescape and replace glob wildcards
    escaped = escaped.replace(r"\*", ".*")
    escaped = escaped.replace(r"\?", ".")
    return escaped + "$"


def _parse_doc_path(doc_path: str) -> tuple:
    """Parse a doc_path into (base_url, file_pattern).

    Example: 'http://host/svn/.../dir/*/sub/*-FINAL.rar'
      → base_url: 'http://host/svn/.../dir/'
      → file_pattern: '.*/.*/.*-FINAL\\.rar$' (regex)
    """
    if not doc_path:
        return None, None

    # Find the position of the first wildcard in the URL path
    parsed = urlparse(doc_path)
    path = parsed.path
    wildcard_pos = -1
    for i, c in enumerate(path):
        if c in ('*', '?'):
            wildcard_pos = i
            break

    if wildcard_pos < 0:
        # No wildcards — the entire path is literal
        return doc_path, None

    # Split into base (before last / before wildcard) and rest
    last_slash = path.rfind('/', 0, wildcard_pos)
    if last_slash < 0:
        # Wildcard at start of path, use root
        base_path = '/'
    else:
        base_path = path[:last_slash + 1]

    # Build base URL
    base_url = f"{parsed.scheme}://{parsed.netloc}{base_path}"

    # Build regex for matching file paths
    # The wildcard pattern covers the relative path from base
    relative_pattern = path[last_slash + 1:] if last_slash >= 0 else path
    file_regex = _glob_to_regex(relative_pattern)

    return base_url, file_regex


def _is_http_url(url: str) -> bool:
    return url.startswith("http://") or url.startswith("https://")


def _list_directory_svn(base_url: str) -> list:
    """Try to list a directory via SVN PROPFIND.
    Returns list of href paths found.
    """
    if not _is_http_url(base_url):
        return []
    data = """<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <resourcetype/>
    <getcontentlength/>
  </prop>
</propfind>"""
    req = urllib.request.Request(base_url, data=data.encode(), method="PROPFIND",
                                  headers={"Depth": "1", "Content-Type": "application/xml"})
    try:
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        body = resp.read().decode("utf-8", errors="replace")
        # Parse href from XML response (simple regex approach)
        hrefs = re.findall(r"<D:href>(.*?)</D:href>", body, re.DOTALL)
        return [h.strip() for h in hrefs]
    except Exception:
        return []


def _list_directory_html(base_url: str) -> list:
    """Try to list a directory via HTTP GET (Apache/nginx directory listing).
    Returns list of href paths found.
    """
    if not _is_http_url(base_url):
        return []
    try:
        req = urllib.request.Request(base_url)
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        body = resp.read().decode("utf-8", errors="replace")
        # Parse href from HTML directory listing
        hrefs = re.findall(r'href="([^"]+)"', body, re.IGNORECASE)
        return [h.strip() for h in hrefs]
    except Exception:
        return []


def check_file_exists(url: str) -> bool:
    """Check if a file exists at the given URL and has non-zero size.
    Uses HTTP HEAD request. Requires http:// or https:// scheme.
    """
    if not _is_http_url(url):
        return False  # not a valid HTTP URL, cannot check
    try:
        req = urllib.request.Request(url, method="HEAD")
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        content_length = resp.headers.get("Content-Length", "0")
        return int(content_length) > 0
    except Exception:
        return False


def scan_doc_path(doc_path: str) -> bool:
    """Scan a single doc_path and return True if a matching file exists.

    Handles wildcards (* and ?) in the path by:
    1. Extracting the base directory URL
    2. Listing the directory contents
    3. Matching file paths against the glob pattern
    4. Checking file size > 0
    """
    if not doc_path:
        return False

    base_url, file_regex = _parse_doc_path(doc_path)

    if base_url is None:
        return False

    if file_regex is None:
        # No wildcards — direct URL check
        return check_file_exists(doc_path)

    # Try to list directory
    entries = _list_directory_svn(base_url)
    if not entries:
        entries = _list_directory_html(base_url)

    if not entries:
        # Can't list — try the base URL directly (some servers auto-index)
        return False

    # Match entries against pattern
    compiled = re.compile(file_regex, re.IGNORECASE)
    for entry in entries:
        # Clean entry (remove base URL prefix, query params)
        filename = entry.rstrip("/")
        if "/" in filename:
            filename = filename.rsplit("/", 1)[-1]
        if compiled.match(filename):
            # Found a match — check if file is non-empty
            file_url = urljoin(base_url, entry) if not entry.startswith("http") else entry
            if check_file_exists(file_url):
                return True

    return False


def check_product_docs(db, product_id: int) -> dict:
    """Scan all docs for a product and auto-update statuses.

    Returns:
        dict with scanned_count, auto_submitted_count, and per-doc results.
    """
    from backend.models.document import ProductDocument, ProductDocTemplate

    docs = db.query(ProductDocument).filter(
        ProductDocument.product_id == product_id
    ).all()

    scanned = 0
    auto_submitted = 0
    results = []

    for doc in docs:
        if doc.status == "submitted":
            # Already submitted — skip scanning
            continue

        # Priority: check user-uploaded location first, then template path
        check_path = doc.location or doc.doc_path or ""
        if not check_path:
            continue

        scanned += 1
        try:
            exists = scan_doc_path(check_path)
        except Exception as e:
            logger.warning(f"Scan failed for doc {doc.id} ({doc.doc_name}): {e}")
            exists = False

        results.append({
            "doc_id": doc.id,
            "doc_name": doc.doc_name,
            "path": check_path,
            "found": exists,
        })

        if exists:
            from datetime import datetime as _dt
            now = _dt.utcnow()
            doc.status = "submitted"
            doc.completed_at = now
            doc.uploaded_by = doc.uploaded_by or "auto-scanner"
            doc.uploaded_at = doc.uploaded_at or now
            doc.updated_by = "auto-scanner"
            doc.updated_at = now
            auto_submitted += 1

    if auto_submitted > 0:
        db.commit()

    return {
        "scanned": scanned,
        "auto_submitted": auto_submitted,
        "results": results,
    }
