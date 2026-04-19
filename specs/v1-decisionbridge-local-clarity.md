# V1 Local Bridge Trust Boundary

This note clarifies the security boundary for local bridge mode. It is a companion to `specs/v1.md` and `specs/v1-decisionbridge.md`.

## Local Bridge Flow

```text
agent
  -> localhost:<port>/api/external-annotations
  -> localhost SSE
  -> browser receives plaintext annotation
  -> browser encrypts with eventKey
  -> browser sends ciphertext to room.plannotator.ai
```

The browser briefly handles plaintext. That is expected and consistent with the zero-knowledge model. The browser is the endpoint that decrypts and renders the plan and annotations for the user.

Zero-knowledge means:

```text
the remote room server cannot read the content
```

It does not mean:

```text
the local browser never sees plaintext
```

## Trusted And Untrusted Components

Trusted in local bridge mode:

- the user's browser
- the user's local machine
- the user's chosen local agent
- the local Plannotator server on `localhost:<port>`

Untrusted / zero-knowledge:

- `room.plannotator.ai`
- Durable Object storage
- room-service logs and observability

Local bridge mode trusts the local agent and local Plannotator server because they receive or generate plaintext annotations. That is intentional when the user asks their own agent to review the plan.

If a participant gives their own agent the room URL, that agent is a direct room client and can decrypt the plan and annotations. This is equivalent to inviting another participant.

## Comparison To Excalidraw

This is not weaker than the relevant Excalidraw model. Excalidraw participants' browsers also hold plaintext scene data and encryption keys while the collaboration server relays encrypted data.

Plannotator's remote room service should still see only ciphertext. The key invariant is:

```text
clients can read plaintext; the remote room server cannot
```
