#!/usr/bin/env python3
"""SQLCipher key management — derive keys from passphrases & rekey databases.

Uses PBKDF2-HMAC-SHA512 with 1,000,000 iterations.
Same passphrase + same salt always produces the same 64-char hex key.

Usage:
    # Generate key from passphrase (interactive)
    python3 gen-sqlcipher-key.py gen

    # Generate key non-interactively
    echo "my-passphrase" | python3 gen-sqlcipher-key.py gen

    # Change database passphrase (rekey)
    python3 gen-sqlcipher-key.py rekey data/pma-8000.db

    # Change database passphrase non-interactively
    echo -e "old-pass\\nnew-pass" | python3 gen-sqlcipher-key.py rekey data/pma-8000.db

WARNING: If you lose the passphrase OR change the salt, your database
         becomes permanently unreadable. Back up your passphrase safely!
"""

import hashlib
import getpass
import os
import subprocess
import sys

SALT = b"pma-sqlcipher-salt-v1"  # Change this to invalidate all existing keys
ITERATIONS = 1_000_000
KEY_LENGTH = 32  # 256 bits → 64 hex chars


def derive_key(passphrase: str) -> str:
    """Derive 64-char hex key from passphrase using PBKDF2."""
    dk = hashlib.pbkdf2_hmac(
        "sha512",
        passphrase.encode("utf-8"),
        SALT,
        ITERATIONS,
        dklen=KEY_LENGTH,
    )
    return dk.hex()


def _read_passphrase(prompt: str, min_len: int = 1) -> str:
    """Read passphrase interactively (hidden) or from stdin pipe."""
    if sys.stdin.isatty():
        pp = getpass.getpass(prompt + ": ")
    else:
        pp = sys.stdin.readline().strip()
    if len(pp) < min_len:
        print(f"错误：passphrase 至少需要 {min_len} 字符", file=sys.stderr)
        sys.exit(1)
    return pp


def _sqlcipher_cli_available() -> bool:
    """Check if sqlcipher CLI is installed."""
    import shutil
    return shutil.which("sqlcipher") is not None


def _rekey_via_cli(db_path: str, old_key: str, new_key: str):
    """Rekey database using sqlcipher CLI tool."""
    # Verify DB is encrypted by trying to open with standard sqlite3
    import sqlite3 as _stdlib_sqlite3
    try:
        conn = _stdlib_sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # If we can read it with standard sqlite3, it's not encrypted
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        conn.close()
        print("错误：数据库未加密，无需 rekey", file=sys.stderr)
        sys.exit(1)
    except Exception:
        pass  # Good — can't open with standard sqlite3 → encrypted

    cmd = ["sqlcipher", db_path]
    stdin = (
        f"PRAGMA key = \"{old_key}\";\n"
        f"SELECT count(*) FROM sqlite_master;\n"  # Verify key is correct
        f"PRAGMA rekey = \"{new_key}\";\n"
        f"SELECT count(*) FROM sqlite_master;\n"  # Verify rekey worked
        f".quit\n"
    )

    result = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or "Error" in result.stderr:
        print(f"Rekey 失败: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    print("数据库密码已更新")


def _rekey_via_python(db_path: str, old_key: str, new_key: str):
    """Rekey database using pysqlcipher3 Python bindings."""
    try:
        import pysqlcipher3.dbapi2 as sqlcipher
    except ImportError:
        print("错误：未安装 pysqlcipher3，请安装后重试: pip install pysqlcipher3", file=sys.stderr)
        sys.exit(1)

    conn = sqlcipher.connect(db_path)
    try:
        conn.execute(f"PRAGMA key = \"{old_key}\"")
        # Verify the key works
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        # Perform rekey
        conn.execute(f"PRAGMA rekey = \"{new_key}\"")
        conn.commit()
        print("数据库密码已更新")
    except Exception as e:
        print(f"Rekey 失败: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


def cmd_gen():
    """Generate a hex key from a passphrase."""
    pp = _read_passphrase("输入 passphrase", min_len=8)
    if sys.stdin.isatty():
        confirm = _read_passphrase("再次输入确认", min_len=1)
        if pp != confirm:
            print("错误：两次输入不一致", file=sys.stderr)
            sys.exit(1)
    key = derive_key(pp)
    print(key)


def cmd_rekey():
    """Change the passphrase for an existing encrypted database."""
    if len(sys.argv) < 3:
        print("用法: python3 gen-sqlcipher-key.py rekey <数据库路径>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[2]
    if not os.path.exists(db_path):
        print(f"错误：数据库文件不存在: {db_path}", file=sys.stderr)
        sys.exit(1)

    print(f"正在为 {db_path} 更换密码...")
    print()

    old_pp = _read_passphrase("当前（旧）passphrase", min_len=1)
    new_pp = _read_passphrase("新 passphrase", min_len=8)
    if sys.stdin.isatty():
        confirm = _read_passphrase("再次输入新 passphrase", min_len=1)
        if new_pp != confirm:
            print("错误：两次输入不一致", file=sys.stderr)
            sys.exit(1)

    if old_pp == new_pp:
        print("新旧密码相同，无需更改")
        sys.exit(0)

    old_key = derive_key(old_pp)
    new_key = derive_key(new_pp)

    print("正在执行 rekey...")

    if _sqlcipher_cli_available():
        _rekey_via_cli(db_path, old_key, new_key)
    else:
        _rekey_via_python(db_path, old_key, new_key)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "gen"
    if cmd == "rekey":
        cmd_rekey()
    elif cmd in ("gen", "generate"):
        cmd_gen()
    else:
        print(f"用法: python3 gen-sqlcipher-key.py [gen|rekey] [db_path]", file=sys.stderr)
        sys.exit(1)
