#!/usr/bin/env python3
"""Servidor de preview local del dashboard.

Simula la arquitectura del Edge: fusiona dos raices, igual que el dispositivo
real sirve "/" desde LittleFS (carpeta data/) y "/models" + "/vendor" desde la
microSD (carpeta sdcard/). El navegador no nota la diferencia: mismas URLs.

Uso:  python tools/preview_server.py [puerto]   (por defecto 8000)
Las llamadas a /api/* devuelven 404 -> el dashboard entra en modo simulado.
"""
import http.server
import json
import os
import socketserver
import sys

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOTS = [os.path.join(BASE, "data"), os.path.join(BASE, "sdcard")]
MAP_LAYOUT_FILE = os.path.join(BASE, "data", "map_layout_persist.json")


class MergedHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = path.split("?", 1)[0].split("#", 1)[0]
        rel = os.path.normpath(rel.lstrip("/")).replace("..", "")
        for root in ROOTS:
            full = os.path.join(root, rel)
            if os.path.exists(full):
                return full
        return os.path.join(ROOTS[0], rel)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def do_GET(self):
        if self.path == "/api/map/layout":
            if os.path.exists(MAP_LAYOUT_FILE):
                with open(MAP_LAYOUT_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._send_json(data)
            else:
                self._send_json({"v": 1, "nodes": [], "cables": []})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/map/layout":
            try:
                body = self._read_body()
                data = json.loads(body)
                with open(MAP_LAYOUT_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                self._send_json({"ok": True})
            except (json.JSONDecodeError, OSError) as e:
                self._send_json({"ok": False, "error": str(e)}, 400)
            return
        self._send_json({"error": "not found"}, 404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(ROOTS[0])
    print("layout persistente: %s" % MAP_LAYOUT_FILE)
    with socketserver.TCPServer(("127.0.0.1", port), MergedHandler) as httpd:
        print("preview en http://127.0.0.1:%d  (data/ + sdcard/ fusionados)" % port)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
