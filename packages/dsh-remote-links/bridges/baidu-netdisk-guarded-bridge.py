#!/usr/bin/env python3
"""Portable guarded bridge; requires mcp-proxy==0.13.0."""
import json, sys, os
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

UNIFIED = Path(os.environ.get("DSH_REMOTE_CONNECTIONS_PATH", str(Path.home()/".dsh"/"remote-connections.json")))
def load_url():
    conn = json.loads(UNIFIED.read_text())["connections"]["baidu-netdisk"]
    if not conn.get("enabled", False):
        raise SystemExit("Baidu connection disabled")
    return conn["endpoint"]["sseUrl"]

url = load_url()
parts = urlsplit(url)
if parts.scheme != "https" or parts.hostname != "mcp-pan.baidu.com" or parts.path != "/sse":
    raise SystemExit("Invalid Baidu official MCP endpoint")
secrets = [v for values in parse_qs(parts.query).values() for v in values if v]

class RedactedStderr:
    def write(self, text):
        for value in secrets:
            text = text.replace(value, "[REDACTED]")
        return sys.__stderr__.write(text)
    def flush(self):
        return sys.__stderr__.flush()
    def __getattr__(self, name):
        return getattr(sys.__stderr__, name)

sys.stderr = RedactedStderr()
sys.argv = ["mcp-proxy", "--log-level", "WARNING", "--transport", "sse", url]
# Direct official endpoint access; avoid inherited malformed IPv6 NO_PROXY entries.
for key in ("NO_PROXY", "no_proxy"):
    os.environ[key] = "localhost,127.0.0.1,mcp-pan.baidu.com"

# Enforce the per-tool encoding contract before any remote mutation.
import re
from mcp import types
import mcp_proxy.sse_client as bridge_transport
_original_create_proxy = bridge_transport.create_proxy_server
async def guarded_proxy(remote):
    app = await _original_create_proxy(remote)
    original_list = app.request_handlers[types.ListToolsRequest]
    original_call = app.request_handlers[types.CallToolRequest]
    async def list_tools(req):
        result = await original_list(req)
        for tool in result.root.tools:
            if tool.name == "make_dir":
                tool.description = "创建百度网盘目录。path 必须是原始 Unicode 绝对路径，如 /备份/资料；禁止 URL 编码，禁止 %HH。file_list.dir 的编码规则不适用于本工具。创建后核对返回 path 和 name；errno=0 本身不能证明路径正确。"
                tool.inputSchema.get("properties", {}).get("path", {})["description"] = tool.description
            elif tool.name == "file_list":
                tool.description = (tool.description or "") + "\n本工具 dir 使用 URL 编码；make_dir.path 则必须使用原始 Unicode，切勿混用。"
        return result
    async def call_tool(req):
        if req.params.name == "make_dir":
            path = (req.params.arguments or {}).get("path")
            if not isinstance(path, str) or not path.startswith("/") or re.search(r"%[0-9a-fA-F]{2}", path) or any(ord(c)<32 for c in path) or any(s in (".", "..") for s in path.split("/")):
                return types.ServerResult(types.CallToolResult(isError=True, content=[types.TextContent(type="text", text='INVALID_REMOTE_PATH: make_dir.path requires a raw Unicode absolute path, e.g. /备份/资料. Do not URL-encode it. Nothing was created. file_list.dir has a different encoding contract.')]))
        return await original_call(req)
    app.request_handlers[types.ListToolsRequest] = list_tools
    app.request_handlers[types.CallToolRequest] = call_tool
    return app
bridge_transport.create_proxy_server = guarded_proxy

from mcp_proxy.__main__ import main
main()
