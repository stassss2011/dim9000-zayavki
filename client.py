"""DIM9000 resident API. Credentials stay on the local machine."""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASES = {'main': 'https://api.dim9000.com/api/',
         'chat': 'https://api-messaging.dim9000.com/api/'}
RESOURCES = {'main': {'orders', 'paid-orders', 'reviews', 'paid-reviews',
                      'paid-order-names', 'spaces', 'files', 'galleries', 'history', 'notifications', 'docs.jsonld'},
             'chat': {'topics', 'messages'}}


class ApiError(Exception):
    def __init__(self, status, data):
        self.status, self.data = status, data
        super().__init__(f'API HTTP {status}')


def validate_path(path, service):
    if service not in BASES or not isinstance(path, str):
        raise ValueError('Unknown API service')
    parsed = urllib.parse.urlsplit(path)
    decoded = urllib.parse.unquote(parsed.path)
    if (parsed.scheme or parsed.netloc or parsed.fragment or path.startswith('/')
            or '%' in decoded or '\\' in decoded or '..' in decoded.split('/')
            or not re.fullmatch(r'[A-Za-z0-9_./-]+', decoded)
            or decoded.split('/')[0] not in RESOURCES[service]):
        raise ValueError('API path is outside the issue module')
    return path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, state_dir=None, *, oauth=None):
        self.state_dir = Path(state_dir or Path(__file__).parent / '.local')
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if oauth is None:
            config = Path(__file__).parent / '.local' / 'oauth.json'
            oauth = json.loads(config.read_text()) if config.exists() else {}
            for key in ('CLIENT_ID', 'CLIENT_SECRET'):
                if os.environ.get('DIM9000_' + key):
                    oauth[key] = os.environ['DIM9000_' + key]
        self.oauth = dict(oauth)
        self.lock = threading.RLock()
        self.opener = urllib.request.build_opener(NoRedirect)

    def load_tokens(self):
        try:
            return json.loads((self.state_dir / 'tokens.json').read_text())
        except FileNotFoundError:
            return None

    def save_tokens(self, data):
        previous = self.load_tokens() or {}
        data = dict(data)
        data['refresh_token'] = data.get('refresh_token') or previous.get('refresh_token')
        data['expires_at'] = time.time() + data.get('expires_in', 0)
        target = self.state_dir / 'tokens.json'
        temporary = self.state_dir / 'tokens.tmp'
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
            json.dump(data, f)
        os.chmod(temporary, 0o600)
        temporary.replace(target)
        return data

    def logout(self):
        with self.lock:
            (self.state_dir / 'tokens.json').unlink(missing_ok=True)

    def transport(self, method, path, *, service='main', token=None, data=None,
                  form=False, raw=None, content_type=None):
        headers = {'Accept': 'application/ld+json' if service == 'main' else 'application/json',
                   'User-Agent': 'dim9000-zayavki/1.0'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        body = raw
        if data is not None:
            body = (urllib.parse.urlencode(data).encode() if form
                    else json.dumps(data, ensure_ascii=False).encode())
        if body is not None:
            headers['Content-Type'] = content_type or (
                'application/x-www-form-urlencoded' if form else
                'application/merge-patch+json' if method == 'PATCH' and service == 'main' else
                'application/ld+json' if service == 'main' else 'application/json')
        req = urllib.request.Request(BASES[service] + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=30) as response:
                payload = response.read()
                if not payload:
                    return None
                try:
                    return json.loads(payload)
                except (ValueError, UnicodeDecodeError):
                    raise ApiError(502, {'message': 'API returned a non-JSON response'})
        except urllib.error.HTTPError as error:
            payload = error.read()
            try:
                result = json.loads(payload)
            except (ValueError, UnicodeDecodeError):
                result = {'message': f'Upstream HTTP {error.code} (non-JSON response)'}
            raise ApiError(error.code, result) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ApiError(504, {'message': 'Не вдалося отримати відповідь API. Якщо це була зміна, '
                            'оновіть список перед повтором: сервер міг уже її виконати.'}) from error

    def grant(self, **fields):
        if not all(self.oauth.get(key) for key in ('CLIENT_ID', 'CLIENT_SECRET')):
            raise ValueError('Configure DIM9000_CLIENT_ID and DIM9000_CLIENT_SECRET before login')
        return self.transport('POST', 'token', data={
            'client_id': self.oauth['CLIENT_ID'], 'client_secret': self.oauth['CLIENT_SECRET'], **fields}, form=True)

    def request_sms(self, phone):
        if not re.fullmatch(r'\+[0-9]{10,15}', phone):
            raise ValueError('Введіть номер у форматі +380…')
        temp = self.grant(grant_type='client_credentials')
        self.transport('POST', 'users/phone-verification', token=temp['access_token'], data={'phone': phone})

    def login(self, phone, code):
        if not re.fullmatch(r'\+[0-9]{10,15}', phone) or not re.fullmatch(r'[0-9]{4,8}', code):
            raise ValueError('Перевірте номер і SMS-код')
        with self.lock:
            temp = self.grant(grant_type='client_credentials')
            self.transport('POST', 'users/code-check', token=temp['access_token'], data={'phone': phone, 'code': code})
            self.save_tokens(self.grant(grant_type='sms', username=phone, smsCode=code))

    def refresh(self):
        tokens = self.load_tokens()
        if not tokens or not tokens.get('refresh_token'):
            raise ApiError(401, {'message': 'Увійдіть через SMS'})
        try:
            return self.save_tokens(self.grant(grant_type='refresh_token', refresh_token=tokens['refresh_token']))
        except ApiError as error:
            if error.status in (400, 401, 403):
                self.logout()
            raise

    def request(self, method, path, data=None, service='main', **kwargs):
        validate_path(path, service)
        with self.lock:
            tokens = self.load_tokens()
            if not tokens:
                raise ApiError(401, {'message': 'Увійдіть через SMS'})
            if tokens.get('expires_at', 0) < time.time() + 60:
                tokens = self.refresh()
            try:
                return self.transport(method, path, service=service, token=tokens['access_token'], data=data, **kwargs)
            except ApiError as error:
                # 401 explicitly means authentication rejected; timeouts/5xx are never replayed.
                if error.status != 401:
                    raise
                tokens = self.refresh()
                return self.transport(method, path, service=service, token=tokens['access_token'], data=data, **kwargs)
