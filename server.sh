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
    echo "Usage: $0 [-p <port>] <command>"
    echo ""
    echo "Options:"
    echo "  -p <port>  指定端口号（默认 8800，也支持 PMA_PORT 环境变量）"
    echo ""
    echo "Commands:"
    echo "  start    启动服务器（后台运行）"
    echo "  stop     停止服务器"
    echo "  restart  重启服务器"
    echo "  status   查看服务器运行状态"
    echo "  logs     查看系统日志（最近 50 行）"
    echo "  tail     实时跟踪系统日志"
    echo "  help     显示此帮助"
    echo ""
    echo "Examples:"
    echo "  $0 -p 8801 start    # 在 8801 端口启动"
    echo "  $0 -p 8801 restart  # 重启 8801 端口服务"
    echo "  $0 -p 8801 status   # 查看 8801 端口状态"
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

    echo -n "[PMA:$PORT] 启动服务器..."
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
    echo -n "[PMA:$PORT] 停止服务器 (PID: $pid)..."
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
        if [ "$err_count" -gt 0 ]; then
            echo "  最近错误: $err_count 条（查看: $0 logs）"
        fi
    else
        echo "  状态:   未运行"
    fi

    # DB info
    local db_file="$SCRIPT_DIR/data/pma.db"
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

# Parse -p <port> argument
PORT_ARG=""
while [ $# -gt 0 ]; do
    case "$1" in
        -p) PORT_ARG="$2"; shift 2 ;;
        *)  break ;;
    esac
done
# Priority: -p arg > PMA_PORT env > default 8800
PORT="${PORT_ARG:-${PMA_PORT:-8800}}"
PID_FILE="$SCRIPT_DIR/.pma-server-$PORT.pid"
LOG_FILE="$SCRIPT_DIR/data/pma-$PORT.log"
SERVER_LOG="$SCRIPT_DIR/data/server-$PORT.log"
BASE_URL="${PMA_URL:-http://$(detect_ip):$PORT}"

case "${1:-help}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_restart ;;
    status)  do_status ;;
    logs)    do_logs ;;
    tail)    do_tail ;;
    help|*)  usage ;;
esac
