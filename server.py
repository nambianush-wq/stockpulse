import os, subprocess, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = 7823
BASE = Path(__file__).parent

CLAUDE_BIN = os.environ.get(
    "CLAUDE_CODE_EXECPATH",
    os.path.expanduser(
        "~/.vscode/extensions/anthropic.claude-code-2.1.162-darwin-arm64"
        "/resources/native-binary/claude"
    ),
)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress per-request noise

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "mode": "claude-cli"})
            return
        body = (BASE / "index.html").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/proxy":
            self._send_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length))
        # Extract system + first user message from Anthropic-format body
        system = payload.get("system", "")
        messages = payload.get("messages", [])
        user_text = ""
        for m in messages:
            if m.get("role") == "user":
                c = m.get("content", "")
                user_text = c if isinstance(c, str) else (c[0].get("text", "") if c else "")
                break
        prompt = (f"{system}\n\n{user_text}".strip()) if system else user_text
        model = payload.get("model", "claude-fable-5")
        max_tokens = payload.get("max_tokens", 400)
        try:
            result = subprocess.run(
                [CLAUDE_BIN, "-p", prompt, "--model", model,
                 "--output-format", "text", "--max-tokens", str(max_tokens)],
                capture_output=True, text=True, timeout=90,
                env=os.environ.copy(),
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr or f"exit {result.returncode}")
            text = result.stdout.strip()
        except Exception as e:
            self._send_json(500, {"error": str(e)})
            return
        self._send_json(200, {"content": [{"type": "text", "text": text}]})


if __name__ == "__main__":
    print(f"StockPulse → http://localhost:{PORT}")
    HTTPServer(("", PORT), Handler).serve_forever()
