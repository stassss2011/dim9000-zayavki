# Hosting design

Use Base44 for the website and its Deno backend functions. Keep the plain
Ukrainian interface and the Python localhost version. The GitHub repository
is public; the deployed shell is public and its backend function checks
the configured owner email before accessing any session or upstream data.
Base44 platform-level private visibility requires a different plan; the
owner gate and deny-all entity rules enforce data privacy on the current plan. No paid subscription is changed automatically.

The hosted frontend calls a single authenticated function, dimApi, with the
same operations as the local API. Each browser gets its own session record;
DIM9000 OAuth tokens are encrypted with AES-GCM before Base44 storage.
Entity permissions deny all direct client reads and writes. Tokens are
never included in frontend responses. Web Locks serialize browser requests
across tabs to avoid refresh-token rotation races. Different devices have
different DIM9000 sessions. Logout removes that browser's server record.

PWA caching contains only the public application shell. API responses,
contacts, issue text and attachments are never cached by the service worker.
An offline screen explains that a connection is needed; writes are never
queued or replayed. Install via the browser's Add to Home Screen command.

Implementation steps:

1. Remove embedded OAuth configuration and private research examples.
   Keep local credentials in ignored .local/oauth.json. Scan staged files.
2. Port client.py, service.py and notifications.py to backend JavaScript;
   retain ownership checks, API errors and no retries for uncertain writes.
3. Add private session storage, owner authentication, encrypted tokens,
   login throttling, and tests using synthetic responses only.
4. Add a hosted frontend adapter, PWA manifest/icons/service worker, mobile
   detail navigation, and a build that copies only an explicit static list.
5. Create the public GitHub repository; CI runs both test suites, syntax,
   build and publication checks. Deploy only trusted main-branch code after
   passing checks, with Base44 credentials in GitHub Actions secrets.
6. Deploy and verify static assets, unauthenticated denial, entity privacy,
   authenticated read operations and phone installation instructions.

No test issues, chat messages, ratings or other resident writes are sent.
The custom domain is optional: the provided Base44 HTTPS URL works first.
