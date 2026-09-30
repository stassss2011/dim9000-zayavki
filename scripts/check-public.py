"""Check tracked publication candidates without printing sensitive matches."""
import re
import subprocess
import sys
from pathlib import Path

files = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
patterns = {
    'local home path': re.compile(r'/Users/[A-Za-z][^\s/]+/'),
    'phone number': re.compile(r'\+380\d{9}'),
    'JWT': re.compile(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+'),
    'private key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub token': re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})'),
    'Base44 key': re.compile(r'b44[kp]_[A-Za-z0-9_-]{20,}'),
    'embedded credential': re.compile(r'(?:client_secret|access_token|refresh_token)[\"\x27]?\s*[:=]\s*[\"\x27][A-Za-z0-9_-]{24,}', re.I),
}
errors = []
for name in filter(None, files):
    path = Path(name)
    if (any(p in {'.local', 'node_modules', '__pycache__', 'dist'} for p in path.parts)
            or path.name in {'.DS_Store', '.app.jsonc'}
            or (path.name.startswith('.env') and path.name != '.env.example')
            or path.suffix in {'.apk', '.hasm', '.hbc', '.pem', '.key'}):
        errors.append((name, 'private/generated file'))
    if path.suffix == '.png':
        continue
    text = subprocess.check_output(['git', 'show', ':' + name]).decode('utf-8', errors='replace')
    for label, pattern in patterns.items():
        if pattern.search(text):
            errors.append((name, label))
    for email in re.findall(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', text):
        if not email.endswith(('.test', '.example', '@example.com', '@users.noreply.github.com')):
            errors.append((name, 'non-example email'))
for name, label in errors:
    print(name + ': ' + label)
if errors:
    sys.exit(1)
print('Publication checks passed: ' + str(len(list(filter(None, files)))) + ' tracked files.')
