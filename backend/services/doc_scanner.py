"""Product document auto-scanner — checks if files exist at template-defined paths.

Parses doc_path patterns with wildcards (*, ?), scans target directories via HTTP,
and auto-marks documents as submitted when matching files are found (size > 0).
"""
import re
import logging
from datetime import datetime as _dt, timezone as _tz, timedelta as _td
from urllib.parse import urljoin, urlparse, unquote
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

    # Normalize common URL typos: http:/ → http:// (but not http:// → http:///)
    doc_path = re.sub(r'^(https?:)/(?!/)', r'\1//', doc_path)

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

    logger.debug(f"[_parse_doc_path] doc_path={doc_path[:120]} -> base_url={base_url} file_regex={file_regex}")
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
    # Depth: 3 to cover two levels below wildcard directory
    # (e.g. PE0454*/售前部/*_技术协议.* where files are 3 levels deep from base)
    req = urllib.request.Request(base_url, data=data.encode(), method="PROPFIND",
                                  headers={"Depth": "3", "Content-Type": "application/xml"})
    _add_svn_auth(req)
    try:
        resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
        body = resp.read().decode("utf-8", errors="replace")
        # Parse href from XML response (simple regex approach)
        hrefs = re.findall(r"<D:href>(.*?)</D:href>", body, re.DOTALL)
        entries = [h.strip() for h in hrefs]
        logger.debug(f"[svn-list] base_url={base_url} entries_count={len(entries)}")
        return entries
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


def _resolve_wildcard_dir(base_url: str, dir_glob: str) -> list:
    """Resolve a single wildcard directory segment to concrete directory names.
    e.g. dir_glob='PE0454*', base_url='http://.../04_项目文档/' → ['PE0454-LSJ0530-研发-双K7中频板采集板', ...]
    """
    entries = _list_directory_svn(base_url)
    if not entries:
        entries = _list_directory_html(base_url)
    if not entries:
        return []

    dir_regex = _glob_to_regex(dir_glob)  # PE0454.*$
    compiled = re.compile(dir_regex, re.IGNORECASE)
    matches = []
    for entry in entries:
        rel = unquote(entry.rstrip("/").lstrip("/"))
        # Only match directory names (not full paths with /)
        name = rel.split("/")[0] if "/" in rel else rel
        if compiled.match(name):
            if name not in matches:
                matches.append(name)
    return matches


def scan_doc_path(doc_path: str):
    """Scan a single doc_path and return the matched file URL if found, or None.

    Handles wildcards (* and ?) by:
    1. Parsing the path into base_url and relative pattern
    2. For the first wildcard directory segment (e.g. PE0454*/),
       resolving it to concrete directory names from SVN
    3. Recursively scanning the resolved path
    4. When no more multi-level wildcards remain, matching files directly
    """
    if not doc_path:
        return None

    base_url, file_regex = _parse_doc_path(doc_path)

    if base_url is None:
        logger.warning(f"[scan_doc_path] base_url=None for doc_path={doc_path[:100]}")
        return None

    if file_regex is None:
        # No wildcards — direct URL check
        if check_file_exists(doc_path):
            return doc_path
        return None

    # Try to list directory
    entries = _list_directory_svn(base_url)
    if not entries:
        entries = _list_directory_html(base_url)

    if not entries:
        return None

    # Check if the relative pattern has a wildcard directory: e.g. PE0454.*/rest
    # Split at the first '/' to get the wildcard dir segment
    first_slash = file_regex.find('/')
    if first_slash > 0:
        # Multi-level pattern: first segment is a wildcard directory
        # Extract the original glob pattern from doc_path for the first segment
        parsed = urlparse(doc_path)
        path = parsed.path
        wildcard_pos = -1
        for i, c in enumerate(path):
            if c in ('*', '?'):
                wildcard_pos = i
                break
        last_slash = path.rfind('/', 0, wildcard_pos)
        relative_pattern = path[last_slash + 1:] if last_slash >= 0 else path
        first_sep = relative_pattern.find('/')
        if first_sep > 0:
            dir_glob = relative_pattern[:first_sep]      # e.g. PE0454*
            rest_glob = relative_pattern[first_sep + 1:]  # e.g. 售前部/*_技术协议.*

            # Resolve wildcard directory to concrete names
            resolved_dirs = _resolve_wildcard_dir(base_url, dir_glob)
            logger.warning(f"[scan_doc_path] resolving dir_glob={dir_glob} -> {len(resolved_dirs)} matches: {resolved_dirs[:5]}")

            for dir_name in resolved_dirs:
                # Build new doc_path with wildcard directory resolved
                new_doc_path = base_url.rstrip("/") + "/" + dir_name + "/" + rest_glob
                logger.warning(f"[scan_doc_path] resolved dir: {new_doc_path[:120]}")
                # Recursively scan the resolved path
                matched_url = scan_doc_path(new_doc_path)
                if matched_url:
                    return matched_url
            return None

    # Single-level pattern or no / in file_regex: match entries directly
    # SVN PROPFIND returns percent-encoded hrefs — decode before matching
    compiled = re.compile(file_regex, re.IGNORECASE)
    for entry in entries:
        rel_path = entry.rstrip("/").lstrip("/")
        decoded = unquote(rel_path)
        if compiled.match(decoded) or compiled.match(rel_path):
            file_url = urljoin(base_url, entry) if not entry.startswith("http") else entry
            if check_file_exists(file_url):
                return file_url
    if len(entries) > 0:
        sample = [unquote(e.rstrip('/').lstrip('/'))[:100] for e in entries[:5]]
        logger.debug(f"[scan_doc_path] no regex match! regex={file_regex} sample={sample}")

    return None


async def _scan_gitlab_releases_batch(docs: list) -> dict:
    """Scan a batch of GitLab release doc_path patterns against actual GitLab releases.

    Args:
        docs: list of (doc, template_path) tuples where doc is a ProductDocument

    Returns:
        dict[int, str | None]: doc_id -> matched release URL (or None if not found)
    """
    from backend.services.gitlab_service import parse_gitlab_release_pattern
    from backend.services.gitlab_client import GitLabClient

    if not docs:
        return {}

    logger.info(f"[gitlab-scan] Scanning {len(docs)} GitLab document(s) for releases")

    # Check GitLab token
    from backend.config import settings
    if not settings.GITLAB_TOKEN:
        logger.warning("[gitlab-scan] GitLab token not configured, skipping all GitLab scans")
        return {}

    # Group docs by (base_url, project_path)
    groups = {}  # (base_url, project_path) -> list of (doc, tag_pattern)
    for doc, template_path in docs:
        parsed = parse_gitlab_release_pattern(template_path)
        if not parsed:
            logger.info(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': skip non-GitLab path={template_path[:120]!r}")
            continue
        base_url, project_path, tag_pattern = parsed
        key = (base_url, project_path)
        if key not in groups:
            groups[key] = []
        groups[key].append((doc, tag_pattern))

    results = {}
    client = GitLabClient()
    try:
        for (base_url, project_path), group in groups.items():
            logger.info(f"[gitlab-scan] Project '{project_path}': fetching releases for {len(group)} doc(s)")
            try:
                releases = await client.get_releases(project_path)
            except Exception as e:
                logger.warning(f"[gitlab-scan] Project '{project_path}': failed to fetch releases: {e}")
                for doc, _ in group:
                    results[doc.id] = None
                continue

            if not releases:
                logger.info(f"[gitlab-scan] Project '{project_path}': no releases found")
                for doc, _ in group:
                    results[doc.id] = None
                continue

            logger.info(f"[gitlab-scan] Project '{project_path}': found {len(releases)} release(s)")
            # Pre-extract tag names
            tag_names = [r.get("tag_name", "") for r in releases if r.get("tag_name")]

            for doc, tag_pattern in group:
                matched_tag = None
                if not tag_pattern:
                    # Empty pattern: match any (first) release
                    if tag_names:
                        matched_tag = tag_names[0]
                        logger.info(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': empty pattern, matched first tag '{matched_tag}'")
                    else:
                        logger.info(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': empty pattern but no releases")
                else:
                    # Build regex from tag_pattern
                    tag_regex = _build_tag_regex(tag_pattern)
                    try:
                        compiled = re.compile(tag_regex, re.IGNORECASE)
                    except re.error as e:
                        logger.warning(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': invalid regex '{tag_regex}': {e}")
                        results[doc.id] = None
                        continue
                    for tag_name in tag_names:
                        if compiled.match(tag_name):
                            matched_tag = tag_name
                            logger.info(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': matched tag '{tag_name}'")
                            break

                if matched_tag:
                    results[doc.id] = f"{base_url}/{project_path}/-/releases/{matched_tag}"
                else:
                    results[doc.id] = None
                    logger.info(f"[gitlab-scan] doc#{doc.id} '{doc.doc_name}': no matching release for pattern '{tag_pattern}'")
    finally:
        await client.close()

    matched_count = sum(1 for v in results.values() if v is not None)
    logger.info(f"[gitlab-scan] Done: {matched_count}/{len(docs)} matched")
    return results


def _build_tag_regex(tag_pattern: str) -> str:
    """Convert a tag pattern to a regex for matching GitLab tag names.

    - If pattern contains glob wildcards (*, ?), convert to regex via _glob_to_regex
    - If pattern contains regex metacharacters (\\d, \\w, [, etc.), use as-is
    - Otherwise, treat as literal text (exact match)
    """
    if not tag_pattern:
        return ".*"  # match any
    if "*" in tag_pattern or "?" in tag_pattern:
        # Glob pattern: convert to regex
        return _glob_to_regex(tag_pattern)
    # Check for regex metacharacters (backslash sequences, brackets, etc.)
    if re.search(r'[\\\.\[\]\{\}\(\)\+\^\$\|]', tag_pattern):
        # Already regex-like, use as-is but ensure it matches full tag name
        if not tag_pattern.endswith("$"):
            tag_pattern = tag_pattern + "$"
        return tag_pattern
    # Literal text: exact match
    return "^" + re.escape(tag_pattern) + "$"


def _is_gitlab_doc(doc_type: str, template_path: str) -> bool:
    """Determine if a document is a GitLab release URL."""
    if doc_type and doc_type.lower() == "gitlab":
        return True
    if not doc_type and template_path and ("gitlab" in template_path.lower() or "/-/releases/" in template_path or "/-/tags/" in template_path):
        return True
    return False


async def check_product_docs(db, product_id: int) -> dict:
    """Scan all docs for a product and auto-update statuses.

    For GitLab-type docs: uses GitLab Release API to validate release URLs.
    For SVN/NAS-type docs: uses HTTP scanning (SVN PROPFIND / directory listing).

    Returns:
        dict with scanned_count, auto_submitted_count, and per-doc results.
    """
    from backend.models.document import ProductDocument

    # Sync documents from templates first (cleanup orphans, update paths/doc_type)
    from backend.services.document_service import get_or_init_product_documents
    get_or_init_product_documents(db, product_id)

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

    # Separate GitLab docs from SVN/NAS docs
    gitlab_docs = []  # list of (doc, template_path)
    svn_docs = []     # list of doc

    for doc in docs:
        template_path = doc.doc_path or ""
        check_path = doc.location or template_path
        if not check_path:
            continue

        # Determine doc_type
        doc_type = doc.doc_type or ""
        if not doc_type and template_path:
            if "svn" in template_path.lower():
                doc_type = "svn"
            elif "gitlab" in template_path.lower() or "git" in template_path:
                doc_type = "gitlab"

        if _is_gitlab_doc(doc_type, template_path):
            gitlab_docs.append((doc, template_path))
        else:
            svn_docs.append(doc)

    # ── GitLab batch scan ──
    if gitlab_docs:
        try:
            gitlab_results = await _scan_gitlab_releases_batch(gitlab_docs)
        except Exception as e:
            logger.warning(f"[doc-scanner] GitLab batch scan failed: {e}")
            gitlab_results = {}

        for doc, template_path in gitlab_docs:
            scanned += 1
            matched_url = gitlab_results.get(doc.id)
            exists = matched_url is not None

            # If pattern didn't match but doc has a manually set location,
            # validate the existing location before reverting
            if not exists and doc.location and doc.status == "submitted":
                try:
                    from backend.services.gitlab_service import validate_release_url
                    vr = await validate_release_url(doc.location)
                    if vr.get("valid"):
                        matched_url = doc.location
                        exists = True
                        logger.info(f"[doc-scanner] doc#{doc.id} '{doc.doc_name}': pattern not matched "
                                    f"but existing location is valid")
                except Exception:
                    pass

            doc_type = doc.doc_type or "gitlab"

            results.append({
                "doc_id": doc.id,
                "doc_name": doc.doc_name,
                "path": matched_url or template_path,
                "template_path": template_path,
                "found": exists,
                "mismatch": "",
                "prev_status": doc.status,
                "doc_type": doc_type,
            })

            now = _dt.utcnow()
            if exists and matched_url:
                total_matched += 1
                loc_url = unquote(matched_url)
                if not doc.location or doc.location != loc_url:
                    doc.location = loc_url
                    location_filled += 1
                if doc.status != "submitted":
                    doc.status = "submitted"
                    doc.completed_at = now
                    doc.uploaded_by = doc.uploaded_by or "auto-scanner"
                    doc.uploaded_at = doc.uploaded_at or now
                    auto_submitted += 1
                doc.updated_by = "auto-scanner"
                doc.updated_at = now

            if not exists and doc.status == "submitted":
                doc.status = "pending"
                doc.completed_at = None
                doc.updated_by = "auto-scanner"
                doc.updated_at = now
                reverted += 1
                logger.warning(f"[doc-scanner] doc#{doc.id} '{doc.doc_name}' "
                               f"reverted to pending: GitLab release not found")

    # ── SVN/NAS scan (existing logic) ──
    for doc in svn_docs:
        template_path = doc.doc_path or ""
        check_path = doc.location or template_path
        if not check_path:
            continue

        scanned += 1
        exists = False
        mismatch = ""

        # If a location was previously resolved, just check if it still exists
        if doc.location and template_path:
            loc_decoded = unquote(doc.location)
            exists = check_file_exists(loc_decoded)
            matched_url = loc_decoded if exists else None
            if not exists:
                # Location file gone — re-scan using template path (with wildcards)
                try:
                    matched_url = scan_doc_path(template_path)
                    exists = matched_url is not None
                except Exception as e:
                    matched_url = None
                    logger.warning(f"Scan failed for doc {doc.id} ({doc.doc_name}): {e}")
            if exists and doc.location != loc_decoded:
                doc.location = loc_decoded
        else:
            # No user location — use template path directly
            try:
                matched_url = scan_doc_path(check_path)
            except Exception as e:
                matched_url = None
                logger.warning(f"Scan failed for doc {doc.id} ({doc.doc_name}): {e}")

        exists = matched_url is not None

        if mismatch:
            logger.warning(f"[doc-scanner] doc#{doc.id} '{doc.doc_name}': {mismatch}")

        # Determine doc_type from template
        doc_type = doc.doc_type or ""
        if not doc_type and template_path:
            if "svn" in template_path.lower():
                doc_type = "svn"
            elif "gitlab" in template_path.lower() or "git" in template_path:
                doc_type = "gitlab"

        results.append({
            "doc_id": doc.id,
            "doc_name": doc.doc_name,
            "path": matched_url or check_path,
            "template_path": template_path,
            "found": exists,
            "mismatch": mismatch,
            "prev_status": doc.status,
            "doc_type": doc_type,
        })

        now = _dt.utcnow()
        if exists and matched_url:
            total_matched += 1
            loc_url = unquote(matched_url)
            if not doc.location or doc.location != loc_url:
                doc.location = loc_url
                location_filled += 1
            if doc.status != "submitted":
                doc.status = "submitted"
                doc.completed_at = now
                doc.uploaded_by = doc.uploaded_by or "auto-scanner"
                doc.uploaded_at = doc.uploaded_at or now
                auto_submitted += 1
            # Update modifier to SVN author if available
            if doc_type == "svn":
                svn_author, _, _ = get_svn_metadata(matched_url)
                if svn_author:
                    doc.updated_by = svn_author
                else:
                    doc.updated_by = "auto-scanner"
            else:
                doc.updated_by = "auto-scanner"
            doc.updated_at = now

        # Fetch SVN metadata (author + last-modified + rev) for SVN-type docs
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


def check_project_docs(db, project_id: int) -> dict:
    """Scan all docs for a project and auto-update statuses.

    Returns:
        dict with scanned_count, auto_submitted_count, and per-doc results.
    """
    from backend.models.document import ProjectDocument

    docs = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == project_id
    ).all()

    scanned = 0
    auto_submitted = 0
    reverted = 0
    location_filled = 0
    total_matched = 0
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
        matched_url = None

        logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' path={check_path[:120]}")

        # If a location was previously resolved, just check if it still exists
        if doc.location and template_path:
            # Decode percent-encoded location if needed (for backward compat)
            loc_decoded = unquote(doc.location)
            exists = check_file_exists(loc_decoded)
            matched_url = loc_decoded if exists else None
            if not exists:
                # Location file gone — re-scan using template path (with wildcards)
                logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' location check failed, re-scanning with template: {template_path[:100]}")
                try:
                    matched_url = scan_doc_path(template_path)
                    exists = matched_url is not None
                except Exception as e:
                    logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' scan failed: {e}")
            # Update stored location to decoded form
            if exists and doc.location != loc_decoded:
                doc.location = loc_decoded
            logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' check_location = {exists} url={matched_url}")
        else:
            # No user location — use template path directly
            try:
                matched_url = scan_doc_path(check_path)
                exists = matched_url is not None
                logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' scan_doc_path = {exists} url={matched_url}")
            except Exception as e:
                logger.warning(f"[project-doc-scan] #{doc.id} '{doc.doc_name}' scan failed: {e}")

        if mismatch:
            logger.warning(f"[doc-scanner] project doc#{doc.id} '{doc.doc_name}': {mismatch}")

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
            "path": matched_url or check_path,
            "template_path": template_path,
            "found": exists,
            "mismatch": mismatch,
            "prev_status": doc.status,
            "doc_type": doc_type,
        })

        now = _dt.utcnow()
        if exists and matched_url:
            total_matched += 1
            # Auto-fill location with the resolved URL (decoded for readability)
            loc_url = unquote(matched_url)
            if not doc.location or doc.location != loc_url:
                doc.location = loc_url
                location_filled += 1
            if doc.status != "submitted":
                doc.status = "submitted"
                doc.completed_at = now
                auto_submitted += 1
            # Use SVN author as updated_by
            if doc_type == "svn":
                svn_author, _, _ = get_svn_metadata(matched_url)
                doc.updated_by = svn_author or "auto-scanner"
            else:
                doc.updated_by = "auto-scanner"
            doc.updated_at = now

        if not exists and doc.status == "submitted":
            # File no longer accessible — revert to pending
            doc.status = "pending"
            doc.completed_at = None
            doc.updated_by = "auto-scanner"
            doc.updated_at = now
            reverted += 1
            logger.warning(f"[doc-scanner] project doc#{doc.id} '{doc.doc_name}' "
                           f"reverted to pending: file not found")

    if auto_submitted > 0 or reverted > 0 or location_filled > 0:
        db.commit()

    return {
        "scanned": scanned,
        "total_matched": total_matched,
        "auto_submitted": auto_submitted,
        "reverted": reverted,
        "location_filled": location_filled,
        "results": results,
    }
