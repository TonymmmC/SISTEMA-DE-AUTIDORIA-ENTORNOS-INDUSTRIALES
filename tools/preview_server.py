#!/usr/bin/env python3
"""Servidor de preview local del dashboard.

Simula la arquitectura del Edge: fusiona dos raices, igual que el dispositivo
real sirve "/" desde LittleFS (carpeta data/) y "/models" + "/vendor" desde la
microSD (carpeta sdcard/). El navegador no nota la diferencia: mismas URLs.

Uso:  python tools/preview_server.py [puerto]   (por defecto 8000)
Las llamadas a /api/* devuelven 404 -> el dashboard entra en modo simulado.
"""
import http.server
import os
import socketserver
import sys

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOTS = [os.path.join(BASE, "data"), os.path.join(BASE, "sdcard")]


class MergedHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = path.split("?", 1)[0].split("#", 1)[0]
        rel = os.path.normpath(rel.lstrip("/")).replace("..", "")
        for root in ROOTS:
            full = os.path.join(root, rel)
            if os.path.exists(full):
                return full
        return os.path.join(ROOTS[0], rel)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(ROOTS[0])
    with socketserver.TCPServer(("127.0.0.1", port), MergedHandler) as httpd:
        print("preview en http://127.0.0.1:%d  (data/ + sdcard/ fusionados)" % port)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
