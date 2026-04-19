# Plannotator Live Rooms PRD

## Problem

Plannotator's review workflow is single-player. One person reviews the plan, annotates it, and approves or denies. If a team of three needs to review the same plan, the current options are:

1. **Sequential handoff.** One person reviews, shares a URL, the next person imports those annotations, adds their own, re-shares. This is slow and loses context between rounds.

2. **Parallel share links.** Each reviewer gets their own copy via a share URL, annotates independently, and sends their link back. The plan author then manually reconciles N sets of feedback. Annotations conflict, duplicate, and lose the conversation between reviewers.

3. **Out-of-band discussion.** Reviewers talk in Slack or a call while one person drives the Plannotator UI. The other reviewers' input is verbal, not captured as structured annotations.

None of these are collaboration. They're workarounds for the absence of it.

This matters because plan review is inherently a team activity. An implementation plan touches multiple people's domains -- backend, frontend, infrastructure, product. The person who wrote the plan is rarely the only person whose input determines whether it's good. When Plannotator forces single-player review, it pushes the multi-party conversation out of the tool and into unstructured channels where feedback is lost.

[PR #316](https://github.com/backnotprop/plannotator/pull/316) from the community attempted to solve this by adding collaborative sessions backed by the paste service. [PR #52](https://github.com/backnotprop/plannotator/pull/52) tried earlier with Supabase real-time sync. PR #52 was closed; PR #316 remains open but raised design and security concerns that this spec addresses. The demand is clear and recurring. The previous attempts failed not because the idea was wrong, but because the infrastructure wasn't right: KV-based optimistic locking is racy under concurrent writes, polling-based sync creates stale state, and the approaches didn't preserve Plannotator's zero-knowledge encryption model.

## Who This Is For

**Team leads and senior engineers** who use Plannotator to review Claude Code or OpenCode plans before approving them. They want input from teammates before making the approve/deny decision, but today they either review alone or leave the tool to gather feedback.

**Teammates and domain experts** who are asked "can you look at this plan?" and currently receive a share link, open it, annotate in isolation, and send it back. They have no way to see what others have already said or build on each other's feedback.

**Agents as reviewers.** Claude, Codex, and other agents can already post annotations to the local Plannotator editor via the external annotations API. Later live-room work should let an agent participate as a first-class room client when the user gives it the room URL, reading the plan and submitting structured encrypted feedback in real time.

## What This Enables

**One URL, one room, everyone annotates together.** The plan creator starts a live room, copies the link, and shares it. Everyone who opens the link sees the same plan, sees each other's cursors, and sees annotations appear in real time. No N-way share-link import/export cycle. No manual reconciliation between reviewers.

**The creator retains the decision.** Only the person who started the room (and whose agent is waiting for a response) can approve or deny the plan. Everyone else contributes annotations. This matches the existing Plannotator model: one decision-maker, now with collaborative input.

**Privacy by default.** The room server coordinates traffic but cannot read plans, annotations, comments, cursor positions, or participant names. All application data is encrypted client-side with a key that lives only in the URL fragment. This is the same zero-knowledge model as Plannotator's existing share links, extended to live collaboration.

**No accounts, no setup.** Collaboration starts with a link. No login, no team workspace, no invitation flow. If you have the link, you're in the room. This matches Plannotator's existing product style and the Excalidraw model that users already understand.

## User Flows

### Starting a Live Room

The plan creator is already in the Plannotator review UI with a plan from their agent. Today they see "Share" with options for hash links and short URLs. With live rooms, they also see "Start live room."

Clicking "Start live room" creates the room, uploads the encrypted plan, and produces a room URL. The creator copies and shares this URL however they normally share links -- Slack, email, a call.

Starting a live room opens it in a new browser tab; the creator's original localhost tab stays on the review UI (where the agent hook is still blocked). In the room tab they see a presence indicator showing connected participants and a room status badge. They can annotate as usual, and their annotations appear for everyone. Approve and Deny are made from the original localhost tab — not from the room tab — because only the localhost tab can complete the waiting agent hook.

If the plan includes image attachments, the room is created normally but images are stripped from annotations and global attachments. The UI shows a notice that image attachments aren't supported in live rooms yet and that encrypted room assets are on the roadmap.

### Joining a Room

A teammate clicks the room URL. The browser opens, derives encryption keys from the URL fragment, authenticates with the room server, and loads the plan with all existing annotations. The teammate sees other participants' cursors and self-identified names from the existing Plannotator display name system, can read all annotations, and can add their own.

The teammate does not see Approve or Deny buttons. They see annotation tools and an export button. Their role is to contribute feedback, not make the decision.

### Annotating Together

When any participant creates an annotation -- a comment, a deletion mark, a quick label -- it appears for everyone within moments. Participants can see each other's cursors moving through the document. If someone is focused on a particular section, others can see that and either contribute there or work elsewhere.

Room annotations appear for everyone in the room, attributed to the participant who created them. Local external annotations continue to work in the creator's localhost editor; forwarding those annotations into a room is later work.

### Approving with Consolidated Feedback

When the creator is satisfied with the review, they switch to their localhost tab, paste or import the consolidated room feedback (via the existing share-hash / paste-short-URL import path), and click Approve there. The localhost POST reaches the local Plannotator server, which returns the decision to the waiting agent.

Locking the room after the decision is a separate, explicit creator action in the room tab (Lock control in the room panel). V1 does not auto-lock on approve; the room stays readable as a frozen snapshot only after the creator chooses to lock.

If the creator denies instead, the room stays active for the current plan version while the agent revises outside the room. In V1, reviewing the revised plan requires starting a new live room. The room model intentionally carries `versionId: "v1"` so a future release can support multiple plan versions in the same room without migrating the data model.

### Locking and Closing

The creator can lock the room at any time to freeze annotations without approving or denying. This is useful when the review discussion is complete but the decision isn't ready yet, or when the creator wants to read through consolidated feedback without new annotations appearing.

Locking is reversible. If the creator locked too early, they unlock and the room returns to active.

When the room is no longer needed, the creator can delete it. This removes all encrypted data from Plannotator's servers. Participants who already received the data may still have it locally -- deletion is a server-side cleanup, not a revocation.

Rooms that are never explicitly deleted expire after 30 days.

## How This Relates to Existing Features

**Static sharing is unchanged.** Hash-based URLs and paste-service short links continue to work exactly as they do today. They remain the right choice for async, one-way sharing where live presence isn't needed.

**The external annotations API is unchanged.** Agents that post to `localhost:<port>/api/external-annotations` continue to work in the localhost editor. The current room integration does not automatically forward localhost external annotations into the room; room feedback transfer is explicit through export/copy/import flows. Forwarding local external annotations into encrypted room operations is a later slice.

**The approve/deny flow is unchanged.** Approve and Deny are local (same-origin) actions from the creator's localhost tab — the same code path as before live rooms. `waitForDecision()` still resolves the same way. The agent feedback loop is untouched. The room is a collaboration layer on top of the existing local decision flow, not a replacement for it.

**The plan review UI is the same editor.** Room mode adds presence indicators, a room status badge, and the lock/unlock/delete controls. The annotation tools, markdown renderer, sidebar, settings, and themes are the same.

## What's Not in V1

**No image attachments in rooms.** The current image model uses local file paths. Sharing images across participants requires encrypted blob storage, which is a meaningful infrastructure addition. V1 strips image attachments from annotations when entering a room and notifies the user. Encrypted room assets are planned as a fast follow.

**No document editing.** The plan is fixed for the life of the room (one version). Participants annotate it but don't modify the underlying markdown. Future versions will support the creator publishing revised plans after a deny cycle, with version tabs and annotation carry-forward.

**No accounts or roles.** Access is link-based. There's a creator (who has the admin capability) and participants (who have the room link). There's no invite list, no viewer-vs-commenter distinction, no team management.

**No CRDTs or conflict-free text editing.** Annotations are discrete objects with stable IDs, not collaborative text ranges. The server sequences operations. This is simpler than a collaborative editor because annotations don't overlap or merge in complex ways.

**No room key rotation or revocation.** If the room link leaks, the only remedy is to delete the room and create a new one. Key rotation is a post-V1 capability.

## Risks

**Adoption requires a behavior change.** Today, reviewers annotate alone. Live rooms require sharing a link and waiting for others to join. If the review culture stays "one person reviews in isolation," rooms won't get used regardless of how well they work. The UX should make starting a room feel as lightweight as copying a share link.

**Bearer links can leak.** The room URL is the access credential. If it's posted publicly, anyone can join and read the encrypted content. This is the same model as Excalidraw, Google Docs "anyone with the link," and Plannotator's existing share URLs -- but it's worth being explicit about in product copy and documentation.

**Image stripping may surprise creators.** Plans with image attachments (mockups, diagrams, screenshots) are common. Stripping images when entering a room means reviewers lose visual context. The notification needs to be clear and upfront, and encrypted room assets should be prioritized as a fast follow.

**Agent participation requires trust.** Giving an agent the room URL gives it full read/write access to the room's encrypted content. This is equivalent to inviting a human participant, but users may not think of it that way. The UX should make this explicit when sharing room URLs with agents.

**The server sees metadata, not content.** While the room server cannot read plans, annotations, or presence data, it can observe room activity patterns: connection counts, message timing, ciphertext sizes, IP addresses, and whether a room is active, locked, or expired. This is inherent to any server-coordinated system and should be documented plainly rather than hidden behind the "zero-knowledge" label.

## Success Criteria

The feature succeeds if:

- A team of 2-4 reviewers can annotate the same plan simultaneously without N-way share-link import/export cycles
- The creator can approve or deny from the localhost tab after bringing consolidated multi-party feedback back through the explicit export/copy/import flow
- The room server stores only ciphertext -- a server compromise does not expose plan content
- The feature works without accounts, configuration, or setup beyond sharing a URL
- Existing single-player review, static sharing, and agent annotation workflows are unaffected

## Reference

Technical implementation: `specs/v1.md`
Implementation approach: `specs/v1-implementation-approach.md`
Later external-annotation forwarding and direct-agent clients: `specs/v1-decisionbridge.md`
Later forwarding trust boundary: `specs/v1-decisionbridge-local-clarity.md`
