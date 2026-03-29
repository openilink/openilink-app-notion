#!/usr/bin/env bash
# Notion App 集成测试启动脚本
# 自动启动 Mock Server 和 App，运行集成测试后清理进程

set -euo pipefail

APP_PORT=8087
MOCK_PORT=9801

# 清理函数：脚本退出时终止后台进程
cleanup() {
  echo "正在清理后台进程..."
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
  [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "清理完成"
}
trap cleanup EXIT

# 等待指定端口可用
wait_for_port() {
  local port=$1
  local timeout=${2:-30}
  local elapsed=0
  echo "等待端口 $port 就绪..."
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      echo "错误：等待端口 $port 超时（${timeout}s）"
      exit 1
    fi
  done
  echo "端口 $port 已就绪"
}

echo "=== 启动 OpeniLink Hub Mock Server ==="
go run github.com/openilink/openilink-hub/cmd/appmock@latest \
  --listen ":${MOCK_PORT}" \
  --webhook-url "http://localhost:${APP_PORT}/hub/webhook" \
  --app-token mock_app_token &
MOCK_PID=$!
wait_for_port "$MOCK_PORT"

echo "=== 启动 Notion App ==="
NOTION_TOKEN=ntn_mock_token \
HUB_URL="http://localhost:${MOCK_PORT}" \
APP_TOKEN=mock_app_token \
PORT=$APP_PORT \
  npm run dev &
APP_PID=$!
wait_for_port "$APP_PORT"

echo "=== 运行集成测试 ==="
npm run test:integration

echo "=== 集成测试完成 ==="
