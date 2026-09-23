# Private Teams fork

## What is implemented

The inherited Anarlog app provides audio capture, local-model transcription,
speaker separation, notes, and summaries. This fork adds an experimental,
read-only macOS Accessibility adapter for the native Microsoft Teams app.
While an Anarlog recording is active and the setting is enabled, it polls the
visible caption surface once per second. It never enables Teams captions,
clicks meeting controls, joins a meeting, or enrolls a voiceprint.

A name is applied only to final transcript words whose normalized phrase and
timestamp agree with one caption observation. At least four words are required;
repeated phrases, conflicting names, uncertain windows, and unsupported layouts
fail closed. Manual speaker corrections take precedence. Names are provisional
display labels, not verified identities and not reusable voice identities.
Different people sharing one Teams microphone can still receive that endpoint's
display name. Short utterances, overlapping speech, translated captions, and
different ASR wording can stay unnamed.

**The native adapter has synthetic parser fixtures, not a captured-and-verified
fixture from your Teams Mac version.** Web caption selectors do not prove that
Teams exposes the same identifiers through Accessibility. If the status says
`captions_off_or_unsupported_layout`, do not assume enabling more permissions
will fix it. The adapter needs a layout-specific update after a non-sensitive
test. Do not weaken the scope/ambiguity checks to guess from a participant list.

## Before work use

Get RealPage's approval for this specific tool, capture method, local storage,
AI models, and retention policy. Obtain required participant consent. This fork
must not be used to bypass organizational recording restrictions. It does not
join as a visible meeting bot; disclose recording yourself. A private GitHub
repository is source-code privacy, not an IT/security approval.

Use only fictional content in initial tests. Never commit recordings, caption
logs, transcripts, credentials, or accessibility dumps of real meetings.

## Build on a Mac

The inherited minimum app OS is macOS 15; individual local models can require
newer macOS or Apple Silicon. Native checks use macOS 26, Node 22, pnpm 11.1.1,
and Rust 1.94.0. Install Xcode and its command-line tools, the Tauri v2
prerequisites, and process-compose 1.122.0 or later, as described in the upstream
[local-development section](README.md#local-development).

Clone using your normal GitHub authentication. No token should be pasted into
source files, build scripts, or chat.

```sh
git clone --branch fix/teams-caption-names https://github.com/colecal/anarlog-teams.git
cd anarlog-teams
pnpm install --frozen-lockfile
pnpm dev:desktop
```

This starts the inherited **Anarlog Dev** app, not a signed production release.
Its identifier is `com.hyprnote.dev`; it can share data with another Anarlog Dev
installation. Use a clean test profile or back up that development library first.
Do not replace a work-approved installation with this prototype.

The first native build is large. macOS code generation is part of the private
CI workflow; use a branch revision whose generated contracts and typecheck have
passed. Upstream stable/nightly release workflows are intentionally absent.

## Local AI configuration

1. In **Settings → Transcription**, select an available on-device model, such as
   Soniqo or Apple Speech where supported. Download its assets before testing.
   Do not select Pro (Cloud) or a hosted provider for a local-only workflow.
2. In **Settings → Intelligence**, configure an on-device provider or a local
   Ollama/LM Studio server. Select a model that your Mac can run. Do not select
   hosted Auto/Pro, remote endpoints, or subscription providers.
3. Keep CloudSync, sharing, telemetry, crash reports, and remembered voices off
   unless separately approved. New installs default these off, but imported
   settings and previously saved preferences are not overwritten.
4. Choose audio retention explicitly. The inherited default retains audio;
   caption evidence remains with the session transcript metadata, not with the
   raw-audio retention timer. Delete the session under your approved retention
   policy. FileVault, device management, and backups remain your responsibility.
5. Validate local transcription and summary generation with a fictional local
   audio sample while disconnected from the internet, after model downloads.
   This is a useful smoke test, not a complete network/security audit. The fork
   has no enforced network denylist; optional upstream cloud features remain.

Teams live captions themselves are a Microsoft Teams feature. Reading them
locally does not make Microsoft's caption generation local, and this adapter
cannot override Teams tenant settings or participant identity hiding.

## Native Teams acceptance test

1. Get permission and create a short, non-work meeting with two consenting test
   participants. Use the **native Teams Mac app**, one active meeting window,
   and headphones to reduce microphone echo.
2. Enable Teams live captions manually. Keep captions visible and use the same
   spoken language as the local transcriber; do not use translated captions.
3. Grant Anarlog Dev Microphone, system-audio/screen-recording permissions as
   prompted, and Accessibility in macOS Privacy & Security. Do not disable macOS
   protections or change Teams tenant policy to make the test work.
4. Enable **Settings → General → Teams caption speaker names (experimental)**.
   Start recording manually. Caption text already visible at startup is ignored.
5. Each participant reads a distinct sentence longer than four words, pausing
   between turns. Verify both local and remote audio exist, words are correct,
   and only matching phrases receive the correct names. Verify names persist
   after stopping and reopening the note and appear correctly in exports and
   the local-model summary. Automated tests do not substitute for this test.
6. Repeat a phrase from both participants, overlap briefly, and hide a speaker
   identity. Ambiguous words must not be confidently assigned. Correct a name
   manually and verify a later render does not overwrite it.
7. Turn the fork setting off, stop recording, switch meetings, and deny
   Accessibility. Check that no new caption observations are added and statuses
   explain unavailable capture. No generic roster/title guess should name remote
   words once caption mode has been enabled for that session.

If step 5 reports an unsupported layout, this is a **blocked native integration**,
not a completed hands-free naming feature. Record only the macOS version, Teams
version, and status for the next debugging pass. Any further AX inspection must
be an explicitly consented synthetic meeting and reviewed/redacted locally.

## Status meanings

| Status                               | Meaning / action                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `disabled` / `not_recording`         | No caption capture should be active.                                          |
| `accessibility_required`             | Grant Accessibility to the test app if approved.                              |
| `no_unique_teams_app`                | No single recognized native Teams process.                                    |
| `no_unique_complete_meeting`         | No unambiguous, completely inspected active meeting.                          |
| `captions_off_or_unsupported_layout` | Captions are off, hidden, or the AX layout is unsupported.                    |
| `waiting_for_captions`               | Caption region found, no eligible named rows yet.                             |
| `capturing`                          | Eligible rows are being observed; this does not guarantee a transcript match. |
| `meeting_changed_restart_recording`  | Stop and start a new recording for the new meeting.                           |
| `capture_limit_reached`              | The session reached 10,000 retained caption observations.                     |
| `capture_error`                      | A read/persistence failed; private contents are not logged.                   |

## Verification and provenance

See [private macOS CI](https://github.com/colecal/anarlog-teams/actions) for native
compilation, tests, generated contracts, and typecheck on the exact branch SHA.
CI cannot sign into a real Teams meeting and does not establish live accuracy,
offline guarantees, or employer approval. No installer is signed or notarized.
Upstream release-automation tests that read omitted publishing workflows are not
part of this private fork's CI; the fork does not publish upstream releases.

Community source was imported without upstream Git history from commit
`39613e537ba4c2ddbd2eb5fb4f33c6bf9e79d11e`. Commercial enterprise source and upstream
deployment workflows were excluded. Original MIT and third-party notices remain
applicable. No ownership or endorsement by Microsoft, RealPage, or Fastrepl is implied.

Research context: [Microsoft caption instructions](https://support.microsoft.com/en-us/teams/meetings/use-live-captions-in-microsoft-teams-meetings),
[participant identity controls](https://support.microsoft.com/en-us/teams/meetings-events/hide-your-identity-in-meeting-captions-and-transcripts-in-microsoft-teams),
[Teams-for-Linux web caption discussion](https://github.com/IsmaelMartinez/teams-for-linux/issues/1554),
and [meeting-transcriber](https://github.com/pasrom/meeting-transcriber). These are
references, not proof that this native AX adapter works; no third-party adapter
code was copied into this implementation.
