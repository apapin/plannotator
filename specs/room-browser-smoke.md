# Room Shell Browser Smoke Tests

Status: **manual for now, automate with Playwright later.**

These tests verify runtime CSP compliance and room-shell asset loading that unit tests cannot cover. The room shell depends on the Worker's routing and asset binding, so smoke must exercise the real path: `/c/:roomId → Worker → /index.html → /assets/* chunks`.

## Local E2E runner

Use the one-command runner for everything below:

```bash
bun run dev:live-room
```

This starts two services:

- **Plannotator editor** at `http://localhost:3000` (Vite dev server, HMR enabled for creator-tab code changes).
- **Room service** at `http://localhost:8787` (`wrangler dev`, serves the built room shell for `/c/:roomId`).

The editor is launched with `VITE_ROOM_BASE_URL=http://localhost:8787`, so clicking "Start live room" creates rooms against the local service instead of production.

Ctrl-C tears both down.

### Iteration scope

- **Creator tab (`localhost:3000`)**: Vite HMR updates the UI on save. Edit `App.tsx` and the creator tab refreshes within ~1s.
- **Room tab (`localhost:8787/c/…`)**: serves the *built* shell bundle. Changes to `RoomApp`, room identity handoff, or any component rendered in the room tab require:
  ```bash
  bun run --cwd apps/room-service build:shell
  ```
  Then refresh the room tab. Intentionally no auto-watcher — keeps the runner simple; the build completes in ~5s when you need it.

### Participant testing

- **Same machine**: use an incognito window or a different browser profile. Paste the participant link into the address bar. Participants do **not** need to run Plannotator — they're just a browser client against the room service.
- **Different machine**: `http://localhost:8787` won't resolve from another host, so the generated participant links have to point at a reachable URL instead of localhost. Two options:

  - **Cloudflare tunnel** — gives a public URL that proxies into your local wrangler dev. In one terminal:
    ```bash
    cloudflared tunnel --url http://localhost:8787
    ```
    In another, pass that URL into the runner so the editor stamps it into participant/admin links:
    ```bash
    ROOM_BASE_URL=https://<your-tunnel>.trycloudflare.com bun run dev:live-room
    ```
    Without the `ROOM_BASE_URL=` override, the runner defaults to `http://localhost:8787` and the copied participant link will be unreachable from other machines.

  - **Staging deploy** — `bun run --cwd apps/room-service deploy` against a staging subdomain (requires Wrangler auth + DNS). Then run the editor against that:
    ```bash
    ROOM_BASE_URL=https://room-staging.plannotator.ai bun run dev:live-room
    ```

## 1. Invalid Room URL (no real room needed)

Open: `http://localhost:8787/c/AAAAAAAAAAAAAAAAAAAAAA#key=invalid`

Verify:
- [ ] HTML loads (200 on document response)
- [ ] JS chunks load (`/assets/*.js` all 200 in Network tab)
- [ ] CSS/fonts load
- [ ] App renders the "This room link looks broken" terminal state
- [ ] `Content-Security-Policy` header present on the document response
- [ ] Browser console has **no CSP violation errors**
- [ ] `Referrer-Policy: no-referrer` present
- [ ] `Cache-Control: no-store` present on document

## 2. Real Room Flow

With `bun run dev:live-room` running, open `http://localhost:3000` in a normal browser window.

1. Configure your identity via Settings (once, then persists per browser profile).
2. Click "Start live review session" from the menu or share tab.
3. A NEW tab opens at `http://localhost:8787/c/:roomId#key=…&admin=…` (plus `&stripped=N` if any annotations had images). The editor tab at `:3000` stays open — approve/deny happen there.
4. **The creator tab should NOT see the join gate.** Identity handoff (`&name=&color=` in the fragment) should have been consumed by `AppRoot` on arrival, written into the room-origin ConfigStore, and stripped from the visible URL.

Verify in the **room tab** (`localhost:8787`):
- [ ] URL fragment contains only `#key=…&admin=…` (plus `&stripped=N` if images were stripped). **No `&name=` or `&color=` visible** — those were stripped by `AppRoot.captureCreatorIdentityFromFragment` after writing to ConfigStore.
- [ ] Creator does **not** see `JoinRoomGate` — they land directly in the room using the name/color they submitted in the Start Room modal.
- [ ] sessionStorage (DevTools → Application → Session Storage → `http://localhost:8787`) contains `plannotator.room.admin.<roomId>` and `plannotator.room.identity-confirmed.<roomId>`. No other room-specific keys.
- [ ] Plan renders with markdown content.
- [ ] Initial snapshot annotations render as document highlights.
- [ ] WebSocket connects (Network → WS tab shows frames).
- [ ] Room panel shows status badge and participant count (`1 here` when alone).
- [ ] Admin controls visible (Lock / Unlock / Delete).
- [ ] **Approve/Deny buttons are NOT visible anywhere in the room UI**, including after a refresh. Room-origin never decides.
- [ ] CommentPopover attachments button is NOT rendered (images don't travel in rooms).
- [ ] Local `.md` markdown links in the plan render as plain text, not clickable anchors. Wikilinks (`[[foo]]`) also render as plain text.
- [ ] Browser console has **no CSP errors** and no mixed-content warnings.
- [ ] DevTools Network: no cross-origin POSTs to localhost from `:8787`; no CORS preflights against `:3000`.

Verify in the **creator tab** (`localhost:3000`):
- [ ] Editor is still mounted; hook is still waiting for a decision.
- [ ] Approve / Deny buttons are present and functional; clicking Approve completes the local hook.
- [ ] Importing exported feedback into the creator tab uses the existing share / paste-import paths (out of scope for this smoke).

### Reload test (same room tab)

1. Refresh the room tab.
2. Verify:
   - [ ] No `JoinRoomGate` — identity is recovered from ConfigStore + the per-room confirmed flag.
   - [ ] Presence color matches what the creator submitted (not the hash-default).
   - [ ] Admin controls still work (admin secret recovered from sessionStorage).

## 3. Peer Interaction (two browser profiles / incognito)

Copy the participant link from the creator tab's RoomPanel. Paste it into an incognito window or a different browser profile.

- [ ] Participant sees `JoinRoomGate` (no prior confirmation for this room in their browser). The name field is prefilled with the room-origin ConfigStore identity (first-ever visitor: a generated tater). The color is the hash-derived default.
- [ ] Participant submits the gate; lands in the room.
- [ ] Both sides see `2 here` in the room panel.
- [ ] Remote cursor flag for the other participant renders and tracks their pointer.
- [ ] Annotations created by either side appear on both within a moment.
- [ ] Deleting an annotation removes the highlight on both sides.
- [ ] Creator clicks Lock → participant sees locked status, annotation creation is disabled for them; existing annotations stay readable.
- [ ] Creator clicks Unlock → participant regains write ability.
- [ ] Creator clicks Delete → participant sees the "room no longer available" terminal screen.

### Participant reload test

1. Participant refreshes their tab mid-session.
2. Verify:
   - [ ] No gate — identity is recovered from ConfigStore + confirmed flag for this room.
   - [ ] Presence reconnects; cursor / annotations resume.
3. Open a *different* room URL (e.g. create a second room as the creator and share that participant link into the same incognito window).
4. Verify:
   - [ ] Gate shows (different roomId = different confirmed flag), but **prefilled** with the name/color the participant already confirmed — they just click through.

## Future: Playwright Automation

When we add Playwright, the minimum automated smoke should:

```ts
// 1. Launch browser, open invalid room URL
await page.goto('http://localhost:8787/c/AAAAAAAAAAAAAAAAAAAAAA#key=invalid', {
  waitUntil: 'networkidle',
});

// 2. Assert terminal error renders
await page.waitForSelector('text=This room link looks broken', { timeout: 5000 });

// 3. Assert CSP header on document
const htmlResponse = /* capture from page.on('response') */;
assert(htmlResponse.headers['content-security-policy']?.includes("default-src 'self'"));

// 4. Assert no failed asset loads
const failedAssets = responses.filter(r => r.url.includes('/assets/') && r.status >= 400);
assert(failedAssets.length === 0);

// 5. Assert no CSP console errors
const cspErrors = consoleMessages.filter(m => m.includes('Content Security Policy'));
assert(cspErrors.length === 0);
```

For real-room smoke, the Playwright test would need to:
- Start `bun run dev:live-room` (or the underlying services) as a fixture.
- Trigger room creation via the creator-tab UI or a helper.
- Navigate to the room URL.
- Assert plan renders, WebSocket connects, annotations paint, identity handoff is consumed.

That requires more infra (fixture lifecycle, UI helpers) and belongs in a dedicated test harness, not inline in the room-service package.
