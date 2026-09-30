#!/usr/bin/env python3
"""Run with python3 server.py; no third-party dependencies required."""
import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from client import ApiError, Client
from service import Service

ROOT = Path(__file__).parent
STATIC = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/read-cache.js': 'read-cache.js'}
STATIC.update({('/' + name): name for name in ('pwa.js', 'sw.js', 'offline.html',
              'manifest.webmanifest', 'icon-192.png', 'icon-512.png')})


def make_server(port=9000, client=None):
    api = client or Client()
    service = Service(api)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # Never log request bodies, tokens or issue contents.

        def send(self, status, data, mime='application/json; charset=utf-8'):
            body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' https: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(body)

        def guard(self):
            port = self.server.server_address[1]
            hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
            if self.headers.get('Host') not in hosts:
                raise ApiError(403, {'message': 'Localhost only'})
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + h for h in hosts}:
                raise ApiError(403, {'message': 'Cross-origin requests are blocked'})
            if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise ApiError(403, {'message': 'Cross-site requests are blocked'})

        def do_GET(self):
            try:
                self.guard()
                path = urlsplit(self.path).path
                if path == '/api/status':
                    self.send(200, {'loggedIn': bool(api.load_tokens())})
                elif path in STATIC:
                    file = ROOT / 'static' / STATIC[path]
                    self.send(200, file.read_bytes(), (mimetypes.guess_type(file)[0] or 'text/plain') + '; charset=utf-8')
                else:
                    self.send(404, {'message': 'Not found'})
            except ApiError as e:
                self.send(e.status, {'error': e.data})

        def do_POST(self):
            try:
                self.guard()
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ApiError(415, {'message': 'JSON required'})
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 15 * 1024 * 1024:
                    raise ApiError(413, {'message': 'Request too large or empty'})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError('JSON object required')
                if self.path == '/api/sms':
                    api.request_sms(str(body.get('phone', '')))
                    result = {'ok': True}
                elif self.path == '/api/login':
                    api.login(str(body.get('phone', '')), str(body.get('code', '')))
                    result = {'ok': True}
                elif self.path == '/api/logout':
                    api.logout()
                    result = {'ok': True}
                elif self.path == '/api/call':
                    result = service.call(body)
                else:
                    raise ApiError(404, {'message': 'Not found'})
                self.send(200, result)
            except ApiError as e:
                self.send(e.status, {'error': e.data})
            except (ValueError, TypeError, KeyError, IndexError) as e:
                self.send(400, {'error': {'message': str(e)}})
            except Exception:
                self.send(500, {'error': {'message': 'Локальна помилка сервера; дані не підтверджено. Оновіть список перед повтором.'}})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9000)
    args = parser.parse_args()
    server = make_server(args.port)
    print(f'DIM9000 Заявки: http://127.0.0.1:{server.server_address[1]}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
