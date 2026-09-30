import tempfile
import time
import unittest
from pathlib import Path

from client import Client, ApiError, validate_path


class ClientTests(unittest.TestCase):
    def test_missing_oauth_configuration_fails_before_network(self):
        with tempfile.TemporaryDirectory() as d:
            client = Client(Path(d), oauth={})
            with self.assertRaisesRegex(ValueError, 'DIM9000_CLIENT_ID'):
                client.grant(grant_type='client_credentials')

    def test_uses_supplied_oauth_configuration(self):
        with tempfile.TemporaryDirectory() as d:
            client = Client(Path(d), oauth={'CLIENT_ID': 'test-client', 'CLIENT_SECRET': 'test-secret'})
            client.transport = lambda method, path, **kwargs: kwargs['data']
            result = client.grant(grant_type='client_credentials')
            self.assertEqual(result['client_id'], 'test-client')
            self.assertEqual(result['client_secret'], 'test-secret')

    def test_rejects_external_and_traversal_paths(self):
        for path in ['https://evil.test', '//evil.test', '../token',
                     'orders/../token', 'orders/%2e%2e/token', 'token',
                     'access-points/1/open', 'orders/1#x']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_path(path, 'main')
        self.assertEqual(validate_path('orders?page=2&space=123', 'main'),
                         'orders?page=2&space=123')

    def test_refresh_persists_rotated_token_and_retries_read(self):
        with tempfile.TemporaryDirectory() as d:
            client = Client(Path(d), oauth={'CLIENT_ID': 'test-client', 'CLIENT_SECRET': 'test-secret'})
            client.save_tokens({'access_token': 'old', 'refresh_token': 'refresh',
                                'expires_in': 3600})
            calls = []
            def transport(method, path, **kwargs):
                calls.append((method, path, kwargs))
                if path == 'token':
                    return {'access_token': 'new', 'refresh_token': 'rotated', 'expires_in': 3600}
                if kwargs['token'] == 'old':
                    raise ApiError(401, {'message': 'expired'})
                return {'hydra:member': [{'id': 'example'}]}
            client.transport = transport
            self.assertEqual(client.request('GET', 'orders')['hydra:member'][0]['id'], 'example')
            self.assertEqual(client.load_tokens()['refresh_token'], 'rotated')
            self.assertEqual(len(calls), 3)
            self.assertEqual((Path(d) / 'tokens.json').stat().st_mode & 0o777, 0o600)

    def test_does_not_retry_ambiguous_write(self):
        with tempfile.TemporaryDirectory() as d:
            client = Client(Path(d), oauth={'CLIENT_ID': 'test-client', 'CLIENT_SECRET': 'test-secret'})
            client.save_tokens({'access_token': 'ok', 'refresh_token': 'r', 'expires_in': 3600})
            calls = []
            def transport(*args, **kwargs):
                calls.append(args)
                raise ApiError(504, {'message': 'timeout'})
            client.transport = transport
            with self.assertRaises(ApiError):
                client.request('POST', 'orders', {'description': 'example'})
            self.assertEqual(len(calls), 1)

    def test_transient_refresh_error_preserves_session(self):
        with tempfile.TemporaryDirectory() as d:
            client = Client(Path(d), oauth={'CLIENT_ID': 'test-client', 'CLIENT_SECRET': 'test-secret'})
            client.save_tokens({'access_token': 'old', 'refresh_token': 'r', 'expires_in': 0})
            def transport(*args, **kwargs):
                raise ApiError(503, {'message': 'unavailable'})
            client.transport = transport
            with self.assertRaises(ApiError):
                client.request('GET', 'orders')
            self.assertEqual(client.load_tokens()['refresh_token'], 'r')


if __name__ == '__main__':
    unittest.main()
