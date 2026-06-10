# EngineAI Voice Roadmap

_Last updated: 2026-06-10_

## Vision

EngineAI becomes a natural voice interlocutor: full-duplex conversation with
instant interruption (barge-in), sub-second responses, and live access to all
Engine data — eventually joining client meetings as a smart participant that
listens, answers questions, and presents data.

## Why the previous attempt failed (and what fixes it)

The earlier prototype was half-duplex (record → transcribe → respond → play)
with no echo cancellation and silence-based turn detection. Three things in
the 2026 stack fix it:

1. **Echo cancellation** — browser AEC (`getUserMedia` constraints) strips the
   AI's own voice from the mic, so the mic stays open while it speaks.
2. **Server-side smart turn detection** — an ML model predicts whether the
   speaker has *finished a thought*, not just stopped making noise.
3. **Native barge-in** — speech-to-speech models stop talking when interrupted,
   mid-word, like a person.

## Architecture decision (June 2026)

**Speech-to-speech (S2S) class, not an STT→LLM→TTS pipeline.** Pipelines sit
at 600–900ms voice-to-voice; S2S models run ~300–500ms with native barge-in.
Immersion requires S2S.

**Chosen engine: xAI Grok Voice Agent API** (`wss://api.x.ai/v1/realtime`):

- OpenAI Realtime-spec compatible — our tool definitions are already in
  OpenAI function format, so the entire EngineAI tool layer (query_engine,
  MeetingBrain, Slack, memory, client context, contracts) plugs in directly.
  Execution stays server-side behind auth + the team/private privacy gate.
- Ephemeral client tokens (`POST /v1/realtime/client_secrets`) let the browser
  connect directly — no persistent relay infra, Vercel-compatible.
- `server_vad` turn detection with barge-in; PCM16 24kHz audio.
- ~$0.05/min. Voice cloning available for a future brand voice.
- We already hold the xAI relationship and API key.

**The reasoning tradeoff and its mitigation**: in S2S mode the conversational
brain is Grok's. For heavy analysis the voice model calls a `consult_analyst`
tool that routes the question (plus data context) to Claude Sonnet server-side
and narrates the result — fast voice up front, deep reasoning behind a tool.

**Alternatives kept warm** (the protocol is shared, so swapping is cheap):

| Engine | Why we'd switch |
|---|---|
| OpenAI gpt-realtime / GPT-Realtime-2 | Best tool-calling precision; GPT-5-class voice reasoning |
| Gemini Live API | *Proactive audio* (only answers when addressed) — earmarked for the meeting-bot phase; affective dialog |
| Hume EVI 4 | Strongest emotional register |
| LiveKit Agents pipeline (Claude brain + Miso One/ElevenLabs TTS) | Fallback if S2S quality disappoints; full model control |
| Miso One (open-weights 8B TTS, 110ms, one-shot cloning) | Brand-voice cloning self-hosted; pipeline TTS component |

## Phases

### Phase 1 — Immersive voice mode in EngineAI (THIS PHASE)

- Full-screen voice overlay (orb + live captions), launched from the
  standalone EngineAI app (home screen + inside conversations).
- Voice: `ara` (warm, conversational). Changeable per session config.
- Browser ↔ xAI WebSocket with ephemeral token; mic with AEC/noise
  suppression; PCM16 24kHz both ways; hard playback flush on barge-in.
- Tools wired: query_engine, lookup_client_context, query_meetingbrain,
  query_slack, search_memory, consult_analyst. Execution via
  `POST /api/ai/voice/tools` with conversation-visibility privacy gate.
- Full transcript persists into the conversation thread (`ai_messages`),
  voice minutes logged to `ai_usage` (~50 tenths/min).

### Phase 2 — Naturalness tuning

- VAD threshold/eagerness tuning; filler acknowledgments while tools run.
- Brand voice clone (xAI Custom Voices, or self-hosted Miso One).
- Hands-free wake ("Hey Engine") while the tab is open.
- Multilingual (Grok voice supports 20+ languages).

### Phase 3 — Meeting participant

- Recall.ai meeting bot (Zoom/Meet/Teams) streams meeting audio in; bot
  output-media speaks back and can present charts as its video feed.
- Address detection ("EngineAI, …") governs when it speaks — consider
  Gemini Live proactive audio for this phase.
- Privacy: a meeting is a *team surface* — the existing
  `conversationVisibility: "team"` gate applies to anything spoken aloud
  (client data OK; personal MeetingBrain/Slack data refused).
- Bot announces itself on join; only workspace members may summon it.

### Phase 4 — Presenter mode

- "Walk us through Q2 social performance" → sequenced charts via bot video
  with narration (generate_chart already exists).

## Operational notes

- Env: uses existing `XAI_API_KEY`. No new infra.
- Cost guardrail: sessions auto-end after 30 min idle (xAI resumption window);
  usage logged per session to `ai_usage` with `type_source: "engineai-voice"`.
- Kill switch: voice respects the AI Control Centre service_config pattern
  (add `engineai-voice` row to kill if needed).
