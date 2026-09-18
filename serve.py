"""
本地运行专家评估网页。

    python serve.py              # http://127.0.0.1:8765/ ，自动打开浏览器
    python serve.py --port 9000 --no-browser

index.html 按 Artifact 的写法只含页面内容（没有 <!doctype>/<head>），
这里在返回时补上外壳，行为与发布成 Artifact 时一致。
本地运行时数据只存在这台电脑的浏览器（localStorage），会后记得在“结果与导出”页导出。
"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))

SHELL_HEAD = (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    "</head><body>"
)
SHELL_TAIL = "</body></html>"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), encoding="utf-8") as fh:
                body = (SHELL_HEAD + fh.read() + SHELL_TAIL).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):  # 安静一点
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), Handler) as httpd:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"专家评估网页：{url}   （Ctrl+C 结束）")
        if not args.no_browser:
            webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
