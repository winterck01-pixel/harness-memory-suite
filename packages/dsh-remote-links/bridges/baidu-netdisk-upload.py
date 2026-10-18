#!/usr/bin/env python3
"""Launch an operator-installed official upload program without logging its token."""
import json, os, runpy, sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
path=Path(os.environ.get("DSH_REMOTE_CONNECTIONS_PATH", str(Path.home()/".dsh"/"remote-connections.json")))
conn=json.loads(path.read_text())["connections"]["baidu-netdisk"]
if not conn.get("enabled") or not conn.get("upload",{}).get("enabled"):
    raise SystemExit("Baidu upload disabled")
u=urlsplit(conn["endpoint"]["sseUrl"])
if u.scheme!="https" or u.hostname!="mcp-pan.baidu.com" or u.path!="/sse":
    raise SystemExit("Invalid official endpoint")
token=parse_qs(u.query).get("access_token",[""])[0]
program=conn["upload"].get("program")
if not token or not isinstance(program,str) or not Path(program).is_file():
    raise SystemExit("Configure the official upload program before enabling uploads")
os.environ["BAIDU_NETDISK_ACCESS_TOKEN"]=token
for key in ("NO_PROXY","no_proxy"):
    os.environ[key]="localhost,127.0.0.1,pan.baidu.com,pcs.baidu.com"
class RedactedStderr:
    def write(self, text): return sys.__stderr__.write(text.replace(token, "[REDACTED]"))
    def flush(self): return sys.__stderr__.flush()
    def __getattr__(self, name): return getattr(sys.__stderr__, name)

sys.stderr = RedactedStderr()
runpy.run_path(program, run_name="__main__")
