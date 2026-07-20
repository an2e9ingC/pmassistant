"""GitLab URL validation and integration service.

Parses GitLab release URLs extracted from Zentao releases and validates
them against the GitLab API. Integrates with the alert system.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from backend.config import settings
from backend.services.gitlab_client import GitLabClient

logger = logging.getLogger(__name__)


def parse_gitlab_release_url(url: str) -> Optional[tuple[str, str, str]]:
    """Parse a GitLab release/tag URL into (base_host, project_path, tag_name).

    Supported URL formats:
      - http://192.168.0.128/rd/product/-/releases/v1.0
      - http://192.168.0.128/rd/product/-/tags/v1.0
      - http://192.168.0.128/group/subgroup/proj/-/releases/v1.0.0

    Returns (base_host, project_path, tag_name) or None if parsing fails.
    """
    if not url:
        return None

    url = url.strip().rstrip("/")

    # Match: <base>/-/releases/<tag>  or  <base>/-/tags/<tag>
    # GitLab URL pattern: /-/releases/ or /-/tags/
    pattern = r"^(https?://[^/]+)/(.+?)/-/(releases|tags)/(.+)$"
    m = re.match(pattern, url)
    if not m:
        logger.debug(f"Failed to parse GitLab URL: {url!r}")
        return None

    base_host = m.group(1)      # e.g. http://192.168.0.128
    project_path = m.group(2)   # e.g. rd/product or group/subgroup/proj
    tag_name = m.group(4)       # e.g. v1.0.0

    # Basic validation: tag_name should not be too long or contain spaces
    if len(tag_name) > 255 or " " in tag_name:
        return None

    return (base_host, project_path, tag_name)


def parse_gitlab_release_pattern(url: str) -> Optional[tuple[str, str, str]]:
    """Parse a GitLab release URL pattern into (base_url, project_path, tag_pattern).

    Unlike parse_gitlab_release_url which requires a concrete tag name,
    this accepts glob/regex patterns in the tag portion.

    Example: 'http://192.168.0.128/bsp_dev/mcu/apm32f407/-/releases/LNS677A-V010_V\\d{4}\\.\\d{2}\\.\\d{2}$'
      -> ('http://192.168.0.128', 'bsp_dev/mcu/apm32f407', 'LNS677A-V010_V\\d{4}\\.\\d{2}\\.\\d{2}$')

    Returns (base_url, project_path, tag_pattern) or None if parsing fails.
    """
    if not url:
        return None

    url = url.strip().rstrip("/")

    # Match: <base>/-/releases/<tag_pattern>  or  <base>/-/tags/<tag_pattern>
    # The tag_pattern may contain glob (*, ?), regex (\d, \w, etc.), or be literal text
    pattern = r"^(https?://[^/]+)/(.+?)/-/(releases|tags)/(.+)$"
    m = re.match(pattern, url)
    if not m:
        logger.debug(f"Failed to parse GitLab release pattern URL: {url!r}")
        return None

    base_url = m.group(1)       # e.g. http://192.168.0.128
    project_path = m.group(2)   # e.g. bsp_dev/mcu/apm32f407
    tag_pattern = m.group(4)    # e.g. LNS677A-V010_V\d{4}\.\d{2}\.\d{2}$

    # Basic validation: tag_pattern should not be too long
    if len(tag_pattern) > 512:
        return None

    return (base_url, project_path, tag_pattern)


async def validate_release_url(url: str) -> dict:
    """Validate a single GitLab release URL.

    Returns:
        {"valid": True/False, "exists_as": "release"|"tag"|None, "error": str|None}
    """
    result = {"valid": False, "exists_as": None, "error": None}

    if not url:
        result["error"] = "URL为空"
        return result

    parsed = parse_gitlab_release_url(url)
    if not parsed:
        result["error"] = "URL格式无法解析"
        return result

    base_host, project_path, tag_name = parsed

    # Only validate URLs pointing to the configured GitLab instance
    configured_host = urlparse(settings.GITLAB_BASE_URL).netloc or ""
    if base_host and configured_host and urlparse(f"//{base_host}").netloc != configured_host:
        logger.debug(f"GitLab URL host mismatch: {base_host} != {configured_host}")
        # Still try to validate — the token might work across hosts

    client = GitLabClient()
    try:
        # Try release first, then tag as fallback
        release = await client.get_release(project_path, tag_name)
        if release:
            result["valid"] = True
            result["exists_as"] = "release"
            return result

        # Fallback: check if at least a tag exists (even without release notes)
        tag = await client.get_tag(project_path, tag_name)
        if tag:
            result["valid"] = True
            result["exists_as"] = "tag"
            return result

        result["error"] = f"GitLab上不存在 release 或 tag: {tag_name}"
        return result
    except Exception as e:
        result["error"] = f"校验失败: {str(e)[:150]}"
        logger.warning(f"GitLab URL validation error for {url!r}: {e}")
        return result
    finally:
        await client.close()


async def validate_all_releases(db: Session, concurrency: int = 5) -> dict:
    """Validate GitLab URLs for all cached releases that have a gitlab_url.
    Updates gitlab_url_valid / gitlab_url_checked_at on each CachedRelease.

    Returns summary dict: {total_checked, valid, invalid, errors}.
    """
    from backend.models.zentao import CachedRelease

    releases = db.query(CachedRelease).filter(
        CachedRelease.gitlab_url.isnot(None),
        CachedRelease.gitlab_url != "",
    ).all()

    if not releases:
        return {"total_checked": 0, "valid": 0, "invalid": 0, "errors": 0}

    sem = asyncio.Semaphore(concurrency)
    valid_count = 0
    invalid_count = 0
    error_count = 0

    async def _validate_one(r: CachedRelease):
        nonlocal valid_count, invalid_count, error_count
        async with sem:
            result = await validate_release_url(r.gitlab_url)
            r.gitlab_url_checked_at = datetime.now(timezone.utc)
            if result["valid"]:
                r.gitlab_url_valid = True
                valid_count += 1
            elif result["error"] and "不存在" in result["error"]:
                r.gitlab_url_valid = False
                invalid_count += 1
            else:
                # Connection error or other — keep old status, mark as checked
                error_count += 1
                if r.gitlab_url_valid is None:
                    r.gitlab_url_valid = False

    await asyncio.gather(*[_validate_one(r) for r in releases])
    db.commit()

    logger.info(
        f"GitLab URL validation complete: {len(releases)} checked, "
        f"{valid_count} valid, {invalid_count} invalid, {error_count} errors"
    )
    return {
        "total_checked": len(releases),
        "valid": valid_count,
        "invalid": invalid_count,
        "errors": error_count,
    }
