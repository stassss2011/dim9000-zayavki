# Local DIM9000 issue manager

Goal: manage the authenticated resident's issues from a PC with plain HTML.
Use the gate opener SMS/OAuth flow, keep credentials on the local server,
and expose only operations supported by the issue module and account rights.

Architecture: Python standard-library HTTP server bound to 127.0.0.1,
an API client with persisted OAuth refresh, and vanilla HTML/JavaScript.
No build step or database. Live responses remain authoritative.

1. Research APK Hermes functions and compare with the ADB-connected app.
   Record endpoints, payloads, permissions and evidence in docs/API.md.
2. Implement client.py and tests/test_client.py: auth, refresh, strict API
   routing, error propagation, safe handling of uncertain mutation outcomes.
3. Implement server.py: localhost/Origin checks, static allowlist, auth and
   resource operations; tokens never enter browser responses.
4. Implement static/index.html and static/app.js: issue list, pagination,
   filtering, detail, create/edit actions allowed by API, transitions,
   reviews, attachments, paid orders and chat capabilities.
5. Verify with unit/integration tests, live read-only API requests and browser
   checks. Do not create real test issues or send support messages.

Review focus: expired credentials; non-JSON/validation upstream errors;
pagination; unsupported resident mutations; uncertain write outcomes;
HTML injection in issue descriptions; cross-origin localhost requests.
