"""Local deterministic API fixture for development; this is not a language model."""
import hashlib
import json
import math
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        print(json.dumps({"endpoint": self.path, "model": value.get("model")}), flush=True)
        if self.path == "/v1/embeddings":
            inputs = value["input"]
            if isinstance(inputs, str):
                inputs = [inputs]
            vectors = []
            for text in inputs:
                vector = [0.01] * 16
                for word in re.findall(r"[\u4e00-\u9fff]|[a-zA-Z]+", text):
                    vector[hashlib.sha256(word.lower().encode()).digest()[0] % 16] += 1
                norm = math.sqrt(sum(x * x for x in vector))
                vectors.append([x / norm for x in vector])
            body = json.dumps({"data": [{"index": i, "embedding": v} for i, v in enumerate(vectors)]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/v1/chat/completions":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for text in ["这是一条本机模拟 API 的测试回答。", "资料已通过检索提供，", "可以点击引用返回原文 [1]。"]:
                chunk = {"choices": [{"delta": {"content": text}}]}
                self.wfile.write(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_error(404)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 1429), Handler)
    print("Development fixture: http://127.0.0.1:1429/v1", flush=True)
    server.serve_forever()
