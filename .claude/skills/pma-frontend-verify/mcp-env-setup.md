# Chrome DevTools MCP 环境部署指南

> 本文档供 `pma-frontend-verify` skill 引用，记录 Chrome DevTools MCP 在无图形界面的 Linux 服务器上的完整部署流程。

## 1. 安装 Google Chrome（deb 版）

> **不要使用 snap 版 Chromium**。snap 的沙箱限制会导致 `chrome-launcher`（MCP 插件底层依赖）无法正常启动浏览器。

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt-get -f install -y
```

验证：
```bash
/opt/google/chrome/chrome --version
# Google Chrome 150.0.7871.128
```

## 2. 安装 xvfb（虚拟 X 显示服务）

无图形界面的服务器没有 X Server，Chrome 在非 headless 模式下需要 DISPLAY。虽然可以通过 `--headless` 参数解决，但 `xvfb` 提供更完整的兼容性。

```bash
sudo apt-get install -y xvfb
```

启动：
```bash
Xvfb :99 -screen 0 1920x1080x24 &>/dev/null &
```

验证：
```bash
DISPLAY=:99 /opt/google/chrome/chrome --version
# 不应报 "Missing X server" 错误
```

## 3. 配置 `~/.claude/settings.json`

### 3.1 添加 DISPLAY 环境变量

```json
"env": {
  "DISPLAY": ":99"
}
```

### 3.2 添加 headless 参数

```json
"pluginConfigs": {
  "chrome-devtools-mcp@claude-plugins-official": {
    "mcpServers": {
      "chrome-devtools": {
        "args": ["--headless"]
      }
    }
  }
}
```

完整 `settings.json` 示例：
```json
{
  "env": {
    "DISPLAY": ":99"
  },
  "pluginConfigs": {
    "chrome-devtools-mcp@claude-plugins-official": {
      "mcpServers": {
        "chrome-devtools": {
          "args": ["--headless"]
        }
      }
    }
  },
  "enabledPlugins": {
    "chrome-devtools-mcp@claude-plugins-official": true
  }
}
```

## 4. 重启 MCP 服务

配置更新后，旧的 MCP 进程不会自动重新读取配置。需要杀掉旧进程，Claude Code 会自动重新拉起：

```bash
pkill -f "chrome-devtools-mcp"
```

或退出并重新启动 Claude Code。

## 5. 验证 MCP 就绪

在 Claude Code 中尝试：
```
navigate_page → http://localhost:8000
```

如果返回 `Successfully navigated`，说明环境部署成功。

## 6. 常见问题

| 错误 | 原因 | 解决 |
|------|------|------|
| `Could not find Google Chrome executable for channel 'stable'` | Chrome 未安装或路径不对 | 检查 `/opt/google/chrome/chrome`；不要用 snap 版 |
| `Missing X server to start the headful browser` | xvfb 未运行或 DISPLAY 未设置 | 重启 xvfb；确认 settings.json 中 `DISPLAY=:99` |
| `Protocol error (Target.setDiscoverTargets): Target closed` | Chrome 启动后立即崩溃 | 确认 Chrome 是 deb 版而非 snap 版；检查 `--headless` 参数 |
| settings.json 编辑被 validation 拒绝 | `mcpServers` 不是顶级字段 | 使用 `pluginConfigs` 而非 `mcpServers`；env 中不要嵌套对象 |
| MCP 工具仍然不可用 | 旧进程未重启 | `pkill -f "chrome-devtools-mcp"` |
