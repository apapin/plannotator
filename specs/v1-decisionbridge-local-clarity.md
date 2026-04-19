# V1 Later External-Annotation Forwarding Trust Boundary

This note clarifies the security boundary for the later local external-annotation forwarding mode. It is a companion to `specs/v1.md` and `specs/v1-decisionbridge.md`.

This is not current Slice 5 room behavior. Today, local external annotations stay in the localhost editor, the room tab does not POST to localhost, and Approve/Deny remain local-only actions in the creator's localhost tab.

## Forwarding Flow

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

Trusted in this later forwarding mode:

- the user's browser
- the user's local machine
- the user's chosen local agent
- the local Plannotator server on `localhost:<port>`

Untrusted / zero-knowledge:

- `room.plannotator.ai`
- Durable Object storage
- room-service logs and observability

This forwarding mode trusts the local agent and local Plannotator server because they receive or generate plaintext annotations. That is intentional when the user asks their own agent to review the plan.

If a participant gives their own agent the room URL, that agent is a direct room client and can decrypt the plan and annotations. This is equivalent to inviting another participant.

## Comparison To Excalidraw

This is not weaker than the relevant Excalidraw model. Excalidraw participants' browsers also hold plaintext scene data and encryption keys while the collaboration server relays encrypted data.

Plannotator's remote room service should still see only ciphertext. The key invariant is:

```text
clients can read plaintext; the remote room server cannot
```
