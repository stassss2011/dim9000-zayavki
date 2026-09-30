import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from client import Client
from server import make_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.client = Client(Path(self.temp.name))
        self.server = make_server(0, self.client)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port)
        c.request(method, path, body, headers or {})
        r = c.getresponse()
        result = r.status, r.read()
        c.close()
        return result

    def test_local_html_and_no_private_files(self):
        self.assertEqual(self.request('GET', '/')[0], 200)
        self.assertEqual(self.request('GET', '/.local/tokens.json')[0], 404)
        self.assertEqual(self.request('GET', '/client.py')[0], 404)

    def test_host_and_origin_guards(self):
        self.assertEqual(self.request('GET', '/api/status', headers={'Host': 'evil.test'})[0], 403)
        self.assertEqual(self.request('POST', '/api/logout', '{}', {
            'Content-Type': 'application/json', 'Origin': 'https://evil.test'})[0], 403)
        self.assertEqual(self.request('POST', '/api/logout', '{}', {
            'Content-Type': 'text/plain'})[0], 415)

    def test_tokens_never_returned_to_browser(self):
        self.client.save_tokens({'access_token': 'PRIVATE_ACCESS', 'refresh_token': 'PRIVATE_REFRESH', 'expires_in': 3600})
        status, body = self.request('GET', '/api/status')
        self.assertEqual(status, 200)
        self.assertNotIn(b'PRIVATE', body)
        self.assertTrue(json.loads(body)['loggedIn'])

    def test_invalid_json_and_payload_type(self):
        headers = {'Content-Type': 'application/json'}
        self.assertEqual(self.request('POST', '/api/call', '{', headers)[0], 400)
        self.assertEqual(self.request('POST', '/api/call', '[]', headers)[0], 400)


if __name__ == '__main__':
    unittest.main()
