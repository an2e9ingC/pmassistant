#!/usr/bin/env python3
"""gitlab_issue_comment.py — Post comments to GitLab issues via PMA API.

Usage:
    # Post to a single issue
    python3 scripts/gitlab_issue_comment.py --issue 182 --body "已上线 vX.X.X。\n\n改动内容:\n- ..."

    # Post to multiple issues
    python3 scripts/gitlab_issue_comment.py --issue 182 --issue 184 --body "已上线 vX.X.X。"

    # Read body from stdin (useful for long content)
    echo "comment body here" | python3 scripts/gitlab_issue_comment.py --issue 182 --body -

    # Read body from file
    python3 scripts/gitlab_issue_comment.py --issue 182 --body @/tmp/comment.txt

Required config (.env):
    PMA_USERNAME — PMA login username (default: admin)
    PMA_PASSWORD — PMA login password (default: admin123)
    PMA_URL — PMA base URL (default: http://localhost:8000)
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_env() -> dict:
    """Load configuration from .env file in the PMA project root."""
    env = {
        "PMA_USERNAME": os.environ.get("PMA_USERNAME", "admin"),
        "PMA_PASSWORD": os.environ.get("PMA_PASSWORD", "admin123"),
        "PMA_URL": os.environ.get("PMA_URL", "http://localhost:8000"),
    }

    # Find .env file: check PMA_ROOT env, then walk up from script dir
    env_files = []
    if os.environ.get("PMA_ROOT"):
        env_files.append(Path(os.environ["PMA_ROOT"]) / ".env")
    # Also try relative to the script location
    script_dir = Path(__file__).resolve().parent.parent
    env_files.append(script_dir / ".env")
    # Also try cwd and parent
    env_files.append(Path.cwd() / ".env")
    env_files.append(Path.cwd().parent / ".env")

    for env_file in env_files:
        if env_file.exists():
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, val = line.partition("=")
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if key in env:
                            env[key] = val
            break

    return env


def get_auth_token(pma_url: str, username: str, password: str) -> str:
    """Login to PMA and get an access token."""
    login_url = f"{pma_url.rstrip('/')}/api/auth/login"
    data = json.dumps({"username": username, "password": password}).encode()
    req = urllib.request.Request(
        login_url,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req)
        body = json.loads(resp.read())
        token = body.get("data", {}).get("access_token", "")
        if not token:
            print(f"ERROR: Login failed — {body.get('message', 'no token')}", file=sys.stderr)
            sys.exit(1)
        return token
    except urllib.error.HTTPError as e:
        print(f"ERROR: Login HTTP {e.code} — {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: Cannot connect to PMA at {pma_url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def post_issue_note(pma_url: str, token: str, issue_iid: int, body: str) -> dict:
    """Post a comment to a GitLab issue via PMA API."""
    url = f"{pma_url.rstrip('/')}/api/gitlab/issue-note"
    data = json.dumps({"issue_iid": issue_iid, "body": body}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        return result
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        return {"code": 1, "message": f"HTTP {e.code}: {e.reason} — {err_body}"}
    except urllib.error.URLError as e:
        return {"code": 1, "message": f"Connection error: {e.reason}"}


def main():
    parser = argparse.ArgumentParser(
        description="Post comments to GitLab issues via PMA API",
        epilog="See script header for usage examples.",
    )
    parser.add_argument(
        "--issue", "-i",
        type=int,
        required=True,
        action="append",
        dest="issues",
        help="Issue IID (can repeat for multiple issues)",
    )
    parser.add_argument(
        "--body", "-b",
        required=True,
        help="Comment body text. Use '-' to read from stdin, '@file' to read from file.",
    )
    parser.add_argument(
        "--dry-run", "-n",
        action="store_true",
        help="Print what would be posted without actually posting",
    )
    args = parser.parse_args()

    # Resolve body from stdin, file, or inline arg
    if args.body == "-":
        body = sys.stdin.read().strip()
    elif args.body.startswith("@"):
        with open(args.body[1:]) as f:
            body = f.read().strip()
    else:
        body = args.body

    if not body:
        print("ERROR: Empty comment body", file=sys.stderr)
        sys.exit(1)

    env = load_env()

    if args.dry_run:
        print(f"[DRY RUN] PMA URL: {env['PMA_URL']}")
        print(f"[DRY RUN] Issues: {args.issues}")
        print(f"[DRY RUN] Body ({len(body)} chars):")
        print(body[:200] + ("..." if len(body) > 200 else ""))
        return

    # Authenticate
    token = get_auth_token(env["PMA_URL"], env["PMA_USERNAME"], env["PMA_PASSWORD"])

    # Post to each issue
    success_count = 0
    for iid in args.issues:
        result = post_issue_note(env["PMA_URL"], token, iid, body)
        if result.get("code") == 0:
            note_id = result.get("data", {}).get("id", "?")
            print(f"OK  issue#{iid} → note id={note_id}")
            success_count += 1
        else:
            print(f"FAIL issue#{iid}: {result.get('message', 'unknown error')}", file=sys.stderr)

    print(f"\n{success_count}/{len(args.issues)} issues commented successfully.")

    if success_count < len(args.issues):
        sys.exit(1)


if __name__ == "__main__":
    main()
