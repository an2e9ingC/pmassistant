#!/bin/bash
# PMA Server Management Script
# Usage: ./server.sh {start|stop|restart|status|logs|tail}
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

HOST="0.0.0.0"

# Auto-detect LAN IP for display (prefer first non-loopback IPv4)
detect_ip() {
    hostname -I 2>/dev/null | awk '{print $1}'
}

# ── Help ──
usage() {
    echo "PMA Server Management"
    echo ""
    echo "Usage: $0 <command> [-p <port>]"
    echo ""
    echo "Commands:"
    echo "  start    启动服务器（后台运行）"
    echo "  stop     停止所有服务器（加 -p 停止指定端口）"
    echo "  restart  重启服务器"
    echo "  status   查看所有运行中的服务器（加 -p 查看单个详情）"
    echo "  logs     查看系统日志（最近 50 行）"
    echo "  tail     实时跟踪系统日志"
    echo "  help     显示此帮助"
    echo ""
    echo "Options:"
    echo "  -p <port>  指定端口号（默认 8000，也支持 PMA_PORT 环境变量）"
    echo ""
    echo "Examples:"
    echo "  $0 status             # 查看所有运行实例"
    echo "  $0 status -p 8000     # 查看 8000 端口详细状态"
    echo "  $0 start -p 8001      # 在 8001 端口启动"
    echo "  $0 restart -p 8001    # 重启 8001 端口服务"
    exit 0
}

# ── Check if server is running ──
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    # Fallback: check by process name
    local running_pid=$(pgrep -f "uvicorn backend.main:app.*$PORT" 2>/dev/null | head -1)
    if [ -n "$running_pid" ]; then
        echo "$running_pid" > "$PID_FILE"
        return 0
    fi
    return 1
}

# ── Get PID ──
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE" 2>/dev/null
    else
        pgrep -f "uvicorn backend.main:app.*$PORT" 2>/dev/null | head -1
    fi
}

# ── Start ──
do_start() {
    if is_running; then
        echo "[PMA:$PORT] 服务器已在运行中 (PID: $(get_pid))"
        echo "[PMA:$PORT] 访问地址: $BASE_URL"
        return 0
    fi

    # Ensure data directory exists
    mkdir -p "$SCRIPT_DIR/data"

    # Rotate server log if too large (max 10MB, keep 5 backups)
    if [ -f "$SERVER_LOG" ]; then
        local server_log_size=$(stat -c%s "$SERVER_LOG" 2>/dev/null || echo 0)
        if [ "$server_log_size" -gt 10485760 ]; then
            for i in 5 4 3 2 1; do
                [ -f "${SERVER_LOG}.${i}" ] && mv "${SERVER_LOG}.${i}" "${SERVER_LOG}.$((i+1))" 2>/dev/null
            done
            mv "$SERVER_LOG" "${SERVER_LOG}.1" 2>/dev/null
            echo "[PMA:$PORT] server log rotated (was $(du -h "$SERVER_LOG.1" 2>/dev/null | cut -f1))"
        fi
    fi

    echo -n "[PMA:$PORT] 启动服务器..."
    # Clear shutdown notice on fresh start
    rm -f "$NOTICE_FILE"
    TZ=Asia/Shanghai PMA_PORT="$PORT" DATABASE_URL="sqlite:///./data/pma-$PORT.db" nohup python3 -m uvicorn backend.main:app \
        --host "$HOST" \
        --port "$PORT" \
        >> "$SERVER_LOG" 2>&1 &

    local pid=$!
    echo "$pid" > "$PID_FILE"

    # Wait for startup
    local waited=0
    while [ $waited -lt 10 ]; do
        sleep 0.5
        waited=$((waited + 1))
        if curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
            echo " 完成"
            echo "[PMA:$PORT] PID: $pid"
            echo "[PMA:$PORT] 访问地址: $BASE_URL"
            echo "[PMA:$PORT] 健康检查: $BASE_URL/api/health"
            return 0
        fi
    done

    # Check if process is still alive
    if kill -0 "$pid" 2>/dev/null; then
        echo " 启动中（可能较慢）"
        echo "[PMA:$PORT] PID: $pid"
        echo "[PMA:$PORT] 查看日志: $0 logs"
    else
        echo " 失败"
        echo "[PMA:$PORT] 启动失败，查看错误日志: tail -20 $SERVER_LOG"
        rm -f "$PID_FILE"
        return 1
    fi
}

# ── Stop ──
do_stop() {
    if ! is_running; then
        echo "[PMA:$PORT] 服务器未运行"
        rm -f "$PID_FILE"
        return 0
    fi

    local pid=$(get_pid)
    # Write shutdown notice so frontend can warn users
    local notice_msg="服务器将在几秒后${reason:-停止}，请保存工作。重启后需重新登录。"
    echo "{\"message\":\"$notice_msg\",\"time\":\"$(date '+%Y-%m-%d %H:%M:%S')\"}" > "$NOTICE_FILE"
    echo -n "[PMA:$PORT] 停止服务器 (PID: $pid)..."
    # Give SSE loop enough time to detect the notice file and push shutdown event to all clients
    sleep 5
    kill "$pid" 2>/dev/null || true

    # Wait for graceful shutdown
    local waited=0
    while [ $waited -lt 20 ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo " 完成"
            rm -f "$PID_FILE"
            return 0
        fi
        sleep 0.5
        waited=$((waited + 1))
    done

    # Force kill if still running
    echo -n " 强制终止..."
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.5
    rm -f "$PID_FILE"
    echo " 完成"
}

# ── Stop All ──
do_stop_all() {
    echo "停止所有 PMA 服务器..."

    local found=0

    # Stop servers from PID files
    for pid_file in "$SCRIPT_DIR"/.pma-server-*.pid; do
        [ -f "$pid_file" ] || continue
        local pid=$(cat "$pid_file" 2>/dev/null)
        [ -n "$pid" ] || continue
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pid_file"
            continue
        fi

        local fname=$(basename "$pid_file")
        local port=$(echo "$fname" | sed 's/\.pma-server-\([0-9]*\)\.pid/\1/')
        echo -n "  [PMA:$port] 停止 (PID: $pid)..."
        kill "$pid" 2>/dev/null || true

        local waited=0
        while [ $waited -lt 20 ]; do
            if ! kill -0 "$pid" 2>/dev/null; then
                echo " 完成"
                rm -f "$pid_file"
                found=$((found + 1))
                break
            fi
            sleep 0.5
            waited=$((waited + 1))
        done

        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
            sleep 0.5
            rm -f "$pid_file"
            echo " 强制终止"
            found=$((found + 1))
        fi
    done

    # Also stop any orphan uvicorn processes
    local orphans=$(pgrep -f "uvicorn backend.main:app" 2>/dev/null)
    if [ -n "$orphans" ]; then
        for pid in $orphans; do
            local already=0
            for pid_file in "$SCRIPT_DIR"/.pma-server-*.pid; do
                [ -f "$pid_file" ] || continue
                [ "$(cat "$pid_file" 2>/dev/null)" = "$pid" ] && already=1 && break
            done
            [ "$already" -eq 1 ] && continue
            echo -n "  [孤儿进程] 停止 (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
            sleep 1
            kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
            echo " 完成"
            found=$((found + 1))
        done
    fi

    echo "已停止 $found 个实例"
}

# ── Restart ──
do_restart() {
    echo "[PMA:$PORT] 重启服务器..."
    do_stop
    sleep 1
    do_start
}

# ── Status ──
do_status() {
    echo "══════════════════════════════════════"
    echo "  PMA Server Status"
    echo "══════════════════════════════════════"

    if is_running; then
        local pid=$(get_pid)
        echo "  状态:   运行中"
        echo "  PID:    $pid"
        echo "  端口:   $PORT"
        echo "  地址:   $BASE_URL"

        # Uptime
        local elapsed=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
        if [ -n "$elapsed" ]; then
            echo "  运行时间: $elapsed"
        fi

        # Memory usage
        local mem=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
        if [ -n "$mem" ]; then
            echo "  内存:   $((mem / 1024)) MB"
        fi

        # Health check
        if curl -s "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
            echo "  健康检查: OK"
        else
            echo "  健康检查: FAIL（进程存在但 API 无响应）"
        fi

        # Recent errors from server log
        local err_count=$(grep -c "ERROR\|CRITICAL" "$SERVER_LOG" 2>/dev/null || echo 0)
        if [ "$err_count" -gt 0 ] 2>/dev/null; then
            echo "  最近错误: $err_count 条（查看: $0 logs）"
        fi
    else
        echo "  状态:   未运行"
    fi

    # DB info
    local db_file="$SCRIPT_DIR/data/pma-$PORT.db"
    if [ -f "$db_file" ]; then
        local db_size=$(du -h "$db_file" | cut -f1)
        echo "  数据库:  $db_file ($db_size)"
    fi

    # Log file info
    if [ -f "$LOG_FILE" ]; then
        local log_size=$(du -h "$LOG_FILE" | cut -f1)
        local log_lines=$(wc -l < "$LOG_FILE")
        echo "  日志:    $LOG_FILE ($log_size, $log_lines 行)"
    fi

    echo "══════════════════════════════════════"
}

# ── Status All (multi-server overview) ──
do_status_all() {
    echo "══════════════════════════════════════════════════════════════"
    echo "  PMA Server Status — All Running Instances"
    echo "══════════════════════════════════════════════════════════════"

    local found=0

    # Collect servers from PID files
    for pid_file in "$SCRIPT_DIR"/.pma-server-*.pid; do
        [ -f "$pid_file" ] || continue
        local pid=$(cat "$pid_file" 2>/dev/null)
        [ -n "$pid" ] || continue
        if ! kill -0 "$pid" 2>/dev/null; then
            continue  # stale PID file
        fi

        # Extract port from filename: .pma-server-8800.pid → 8800
        local fname=$(basename "$pid_file")
        local port=$(echo "$fname" | sed 's/\.pma-server-\([0-9]*\)\.pid/\1/')

        _print_server_row "$port" "$pid"
        found=$((found + 1))
    done

    # Also check for uvicorn processes without PID files
    local uvicorn_pids=$(pgrep -f "uvicorn backend.main:app" 2>/dev/null)
    if [ -n "$uvicorn_pids" ]; then
        for pid in $uvicorn_pids; do
            # Skip if already covered by a PID file
            local already_listed=0
            for pid_file in "$SCRIPT_DIR"/.pma-server-*.pid; do
                [ -f "$pid_file" ] || continue
                local fpid=$(cat "$pid_file" 2>/dev/null)
                if [ "$fpid" = "$pid" ]; then
                    already_listed=1
                    break
                fi
            done
            [ "$already_listed" -eq 1 ] && continue

            # Extract port from command line
            local port=$(ps -o args= -p "$pid" 2>/dev/null | grep -oP '(?<=--port )\d+')
            [ -z "$port" ] && port="?"
            _print_server_row "$port" "$pid"
            found=$((found + 1))
        done
    fi

    if [ "$found" -eq 0 ]; then
        echo "  没有运行中的 PMA 服务器"
    fi

    echo "──────────────────────────────────────────────────────────"
    echo "  共 $found 个运行实例"
    echo "══════════════════════════════════════════════════════════════"
}

# ── Print a single server row in compact format ──
_print_server_row() {
    local port="$1"
    local pid="$2"

    local ip=$(detect_ip)
    local url="http://${ip}:${port}"

    # Uptime
    local elapsed=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')

    # Memory
    local mem=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
    local mem_mb="?"
    [ -n "$mem" ] && mem_mb="$((mem / 1024))M"

    # Health
    local health="?"
    if curl -s --max-time 2 "http://localhost:${port}/api/health" > /dev/null 2>&1; then
        health="OK"
    else
        health="FAIL"
    fi

    # Branch info (if available via API)
    local branch=""
    if [ "$health" = "OK" ]; then
        branch=$(curl -s --max-time 2 "http://localhost:${port}/api/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('branch',''))" 2>/dev/null || true)
    fi

    # SQLCipher status
    local sqlcipher_status="明文"
    if [ -f "$SCRIPT_DIR/.env" ] && grep -q "^SQLCIPHER_KEY=" "$SCRIPT_DIR/.env" 2>/dev/null; then
        local key_val=$(grep "^SQLCIPHER_KEY=" "$SCRIPT_DIR/.env" | head -1 | cut -d= -f2-)
        if [ -n "$key_val" ] && [ "$key_val" != '""' ]; then
            sqlcipher_status="🔒 加密"
        fi
    fi

    printf "  端口 %-6s PID %-8s 运行 %-10s 内存 %-6s 健康 %s  加密 %s\n" \
        "$port" "$pid" "${elapsed:-?}" "$mem_mb" "$health" "$sqlcipher_status"
    if [ -n "$branch" ]; then
        echo "         分支: $branch  |  $url"
    else
        echo "         地址: $url"
    fi
    echo ""
}

# ── Logs ──
do_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -50 "$LOG_FILE"
    else
        echo "[PMA:$PORT] 日志文件不存在: $LOG_FILE"
        if [ -f "$SERVER_LOG" ]; then
            echo "[PMA:$PORT] 服务器日志 (最近 20 行):"
            tail -20 "$SERVER_LOG"
        fi
    fi
}

# ── Tail (follow) ──
do_tail() {
    local target="$LOG_FILE"
    if [ ! -f "$target" ]; then
        target="$SERVER_LOG"
    fi
    if [ ! -f "$target" ]; then
        echo "[PMA:$PORT] 没有可用的日志文件"
        exit 1
    fi
    echo "[PMA:$PORT] 实时跟踪: $target (Ctrl+C 退出)"
    tail -f "$target"
}

# ── Dispatch ──

# Parse arguments in any order: ./server.sh [-p <port>] <command>
CMD=""
PORT_ARG=""
PORT_EXPLICIT=0
while [ $# -gt 0 ]; do
    case "$1" in
        -p) PORT_ARG="$2"; PORT_EXPLICIT=1; shift 2 ;;
        start|stop|restart|status|logs|tail|help) CMD="$1"; shift ;;
        *)  echo "未知参数: $1"; usage ;;
    esac
done
CMD="${CMD:-help}"

# Determine default port
DEFAULT_PORT="${PMA_PORT:-8000}"
PORT="${PORT_ARG:-$DEFAULT_PORT}"
# Trunk branch: force default port for start/restart, ignore -p
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$CURRENT_BRANCH" = "trunk" ] && [ "$PORT_EXPLICIT" -eq 1 ]; then
    case "$CMD" in
        start|restart)
            echo "[PMA] trunk 分支仅允许使用默认端口 $DEFAULT_PORT，忽略 -p $PORT_ARG"
            PORT="$DEFAULT_PORT"
            ;;
    esac
fi
PID_FILE="$SCRIPT_DIR/.pma-server-$PORT.pid"
LOG_FILE="$SCRIPT_DIR/data/pma-$PORT.log"
SERVER_LOG="$SCRIPT_DIR/data/server-$PORT.log"
NOTICE_FILE="$SCRIPT_DIR/data/.shutdown-notice-$PORT.json"
BASE_URL="${PMA_URL:-http://$(detect_ip):$PORT}"

case "$CMD" in
    start)   do_start ;;
    stop)
        if [ "$PORT_EXPLICIT" -eq 1 ]; then
            do_stop
        else
            do_stop_all
        fi
        ;;
    restart) do_restart ;;
    status)
        if [ "$PORT_EXPLICIT" -eq 1 ]; then
            do_status
        else
            do_status_all
        fi
        ;;
    logs)    do_logs ;;
    tail)    do_tail ;;
    help|*)  usage ;;
esac
