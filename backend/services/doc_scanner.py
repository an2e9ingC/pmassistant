"""Product document auto-scanner — checks if files exist at template-defined paths.

Parses doc_path patterns with wildcards (*, ?), scans target directories via HTTP,
and auto-marks documents as submitted when matching files are found (size > 0).
"""
import re
import logging
from datetime import datetime as _dt, timezone as _tz, timedelta as _td
from urllib.parse import urljoin, urlparse
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

# Timeout for HTTP requests (seconds)
HTTP_TIMEOUT = 10


def _encode_url(url: str) -> str:
    """Percent-encode non-ASCII characters in a URL path/query."""
    import urllib.parse
    scheme, netloc, path, query, fragment = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(path, safe="/:@%")
    query = urllib.parse.quote(query, safe="=&%")
    return urllib.parse.urlunsplit((scheme, netloc, path, query, fragment))


def _add_svn_auth(req: urllib.request.Request) -> urllib.request.Request:
    """Add Basic auth header if SVN credentials are configured."""
    import os
    import base64
    svn_user = os.environ.get("SVN_USERNAME", "")
    svn_pass = os.environ.get("SVN_PASSWORD", "")
    if svn_user and svn_pass:
        cred = base64.b64encode(f"{svn_user}:{svn_pass}".encode()).decode()
        req.add_header("Authorization", f"Basic {cred}")
    return req


def _relative_path(base_url: str, full_url: str) -> str:
    """Extract the relative path of full_url from base_url.
    Returns e.g. 'LNS677A-V010/05_file.rar' or '' if URLs don't share the same base.
    """
    import urllib.parse
    base_parsed = urllib.parse.urlparse(base_url)
    full_parsed = urllib.parse.urlparse(full_url)
    if base_parsed.netloc != full_parsed.netloc:
        return ""
    base_path = base_parsed.path.rstrip("/") + "/"
    full_path = full_parsed.path
    if full_path.startswith(base_path):
        return full_path[len(base_path):]
    # Try with decoded paths (SVN PROPFIND returns percent-encoded, base may be unencoded)
    from urllib.parse import unquote
    if full_path.startswith(unquote(base_path)):
        return full_path[len(unquote(base_path)):]
    return ""


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
    # Percent-encode non-ASCII characters in URL (e.g. Chinese path segments)
    base_url = _encode_url(base_url)
    data = """<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <resourcetype/>
    <getcontentlength/>
  </prop>
</propfind>"""
    # Depth: 2 to list files one level below wildcard directory
    # (templates like */*-pattern.rar match files inside product subdirectories)
    req = urllib.request.Request(base_url, data=data.encode(), method="PROPFIND",
                                  headers={"Depth": "2", "Content-Type": "application/xml"})
    _add_svn_auth(req)
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
    base_url = _encode_url(base_url)
    try:
        req = urllib.request.Request(base_url)
        _add_svn_auth(req)
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        body = resp.read().decode("utf-8", errors="replace")
        # Parse href from HTML directory listing
        hrefs = re.findall(r'href="([^"]+)"', body, re.IGNORECASE)
        return [h.strip() for h in hrefs]
    except Exception:
        return []


def check_file_exists(url: str) -> bool:
    """Check if a file exists at the given URL.
    Uses HTTP HEAD request. Requires http:// or https:// scheme.
    Note: SVN WebDAV servers often return Content-Length: 0 on HEAD,
    so we only check HTTP 2xx status.
    """
    if not _is_http_url(url):
        return False  # not a valid HTTP URL, cannot check
    url = _encode_url(url)
    try:
        req = urllib.request.Request(url, method="HEAD")
        _add_svn_auth(req)
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        return resp.status >= 200 and resp.status < 300
    except Exception:
        return False


def _format_svn_date(rfc1123_str: str) -> str:
    """Parse an RFC 1123 date string (e.g. 'Mon, 06 Jul 2026 03:29:20 GMT')
    and return a Beijing-time string (YYYY-MM-DD HH:MM:SS)."""
    if not rfc1123_str:
        return ""
    try:
        from email.utils import parsedate_to_datetime
        utc_dt = parsedate_to_datetime(rfc1123_str)
        beijing_dt = utc_dt + _td(hours=8)
        return beijing_dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return rfc1123_str[:19] if len(rfc1123_str) >= 19 else rfc1123_str


def get_svn_metadata(url: str) -> tuple:
    """Get SVN file author, last-modified (Beijing time), and revision via PROPFIND.
    Returns (author, last_modified_beijing, rev) or (None, None, None).
    """
    if not _is_http_url(url):
        return None, None, None
    url = _encode_url(url)
    data = """<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <creator-displayname/>
    <getlastmodified/>
    <version-name/>
  </prop>
</propfind>"""
    try:
        req = urllib.request.Request(url, data=data.encode(), method="PROPFIND",
                                      headers={"Depth": "0", "Content-Type": "application/xml"})
        _add_svn_auth(req)
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        body = resp.read().decode("utf-8", errors="replace")
        import re as _re
        # Match any namespace prefix (D:, lp1:, g0:, etc.) or no prefix
        author_m = _re.search(r"<[\w]*:?creator-displayname>([^<]+)</[\w]*:?creator-displayname>", body)
        date_m = _re.search(r"<[\w]*:?getlastmodified>([^<]+)</[\w]*:?getlastmodified>", body)
        rev_m = _re.search(r"<[\w]*:?version-name>([^<]+)</[\w]*:?version-name>", body)
        author = author_m.group(1).strip() if author_m else None
        lastmod_raw = date_m.group(1).strip() if date_m else None
        lastmod = _format_svn_date(lastmod_raw) if lastmod_raw else None
        rev = rev_m.group(1).strip() if rev_m else None
        if author or lastmod or rev:
            logger.debug(f"[svn-metadata] {url}: author={author}, lastmod={lastmod}, rev={rev}")
        else:
            logger.warning(f"[svn-metadata] PROPFIND response missing expected fields for {url}: {body[:200]}")
        return author, lastmod, rev
    except Exception as e:
        logger.warning(f"[svn-metadata] PROPFIND failed for {url}: {type(e).__name__}: {e}")
        return None, None, None


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

    # Match entries against pattern (match against full entry path; .* is greedy)
    compiled = re.compile(file_regex, re.IGNORECASE)
    for entry in entries:
        rel_path = entry.rstrip("/").lstrip("/")
        if compiled.match(rel_path):
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
    reverted = 0
    location_filled = 0
    total_matched = 0
    svn_meta_updated = 0
    results = []

    from datetime import datetime as _dt

    for doc in docs:
        template_path = doc.doc_path or ""
        check_path = doc.location or template_path
        if not check_path:
            continue

        scanned += 1
        exists = False
        mismatch = ""

        # If user set a location, validate it matches the template
        if doc.location and template_path:
            if template_path != doc.location:
                mismatch = f"路径与模板不匹配（期望: {template_path}）"
            else:
                exists = check_file_exists(doc.location)
        else:
            # No user location — use template path directly
            try:
                exists = scan_doc_path(check_path)
            except Exception as e:
                logger.warning(f"Scan failed for doc {doc.id} ({doc.doc_name}): {e}")

        if mismatch:
            logger.warning(f"[doc-scanner] doc#{doc.id} '{doc.doc_name}': {mismatch}")

        # Determine doc_type from template (prefer doc.doc_type, fallback to template)
        doc_type = doc.doc_type or ""
        if not doc_type and template_path:
            if "svn" in template_path.lower():
                doc_type = "svn"
            elif "gitlab" in template_path.lower() or "git" in template_path:
                doc_type = "gitlab"

        results.append({
            "doc_id": doc.id,
            "doc_name": doc.doc_name,
            "path": check_path,
            "template_path": template_path,
            "found": exists,
            "mismatch": mismatch,
            "prev_status": doc.status,
            "doc_type": doc_type,
        })

        now = _dt.utcnow()
        if exists:
            total_matched += 1
            # Auto-fill location with the verified path (only if no wildcards — direct URL)
            if check_path and '*' not in check_path and '?' not in check_path:
                if not doc.location:
                    doc.location = check_path
                    doc.updated_by = "auto-scanner"
                    doc.updated_at = now
                    location_filled += 1
            if doc.status != "submitted":
                doc.status = "submitted"
                doc.completed_at = now
                doc.uploaded_by = doc.uploaded_by or "auto-scanner"
                doc.uploaded_at = doc.uploaded_at or now
                doc.updated_by = "auto-scanner"
                doc.updated_at = now
                auto_submitted += 1

        # Fetch SVN metadata (author + last-modified + rev) for SVN-type docs
        # Do this regardless of HEAD/scan result — PROPFIND itself confirms accessibility
        if doc_type == "svn" and check_path:
            prev_rev = doc.svn_rev
            logger.debug(f"[doc-scanner] Fetching SVN metadata for doc#{doc.id} '{doc.doc_name}': {check_path}")
            svn_author, svn_lastmod, svn_rev = get_svn_metadata(check_path)
            if svn_author:
                doc.svn_author = svn_author
                svn_meta_updated += 1
            if svn_lastmod:
                doc.svn_last_modified = svn_lastmod
                svn_meta_updated += 1
            if svn_rev:
                doc.svn_rev = svn_rev
                svn_meta_updated += 1
                # Log product activity if revision changed (new or updated)
                if prev_rev and prev_rev != svn_rev:
                    try:
                        from backend.services.product_service import log_product_activity
                        detail = (f"SVN文档更新: {doc.doc_name} "
                                  f"(r{prev_rev} → r{svn_rev}, 提交人: {svn_author or '未知'})")
                        log_product_activity(db, product_id, svn_author or "SVN", "文档更新", detail)
                    except Exception:
                        pass
                elif not prev_rev and svn_rev:
                    try:
                        from backend.services.product_service import log_product_activity
                        detail = (f"SVN文档首次记录: {doc.doc_name} "
                                  f"(r{svn_rev}, 提交人: {svn_author or '未知'})")
                        log_product_activity(db, product_id, svn_author or "SVN", "文档记录", detail)
                    except Exception:
                        pass

        if not exists and doc.status == "submitted":
            # File no longer accessible — revert to pending
            doc.status = "pending"
            doc.completed_at = None
            doc.updated_by = "auto-scanner"
            doc.updated_at = now
            reverted += 1
            logger.warning(f"[doc-scanner] doc#{doc.id} '{doc.doc_name}' "
                           f"reverted to pending: file not found")

    if auto_submitted > 0 or reverted > 0 or location_filled > 0 or svn_meta_updated > 0:
        db.commit()

    return {
        "scanned": scanned,
        "total_matched": total_matched,
        "auto_submitted": auto_submitted,
        "reverted": reverted,
        "location_filled": location_filled,
        "results": results,
    }
