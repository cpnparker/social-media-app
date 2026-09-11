# Training the "Orac" wake-word model (openWakeWord)

One-time, ~2–2.5 hours on a free Google Colab GPU, £0.

> v2 recipe (2026-06-12): the first model (6k samples) speaker-overfit —
> it fired for exactly one TTS voice and scored ~0 for every real voice.
> Config now generates 30k samples, trains 50k steps with gentler negative
> weighting. If a trained model "only ever returns 0%", test breadth with
> several `say -v <voice>` voices before blaming the runtime engine.

## What you get

Three small ONNX files (~3MB total) that replace the 80MB Whisper-based
wake detection with an always-on, frame-level keyword spotter — the same
architecture as Alexa/Siri wake words:

- `orac.onnx` — the trained "Orac" classifier (your custom model)
- `melspectrogram.onnx` — audio → mel features (ships with openWakeWord)
- `embedding_model.onnx` — mel → speech embeddings (ships with openWakeWord)

## Steps

1. Open [Google Colab](https://colab.research.google.com) → File → Upload
   notebook → upload `orac_training_colab.ipynb` from this folder.
2. Runtime → Change runtime type → **T4 GPU** → Save.
3. Runtime → Run all. Walk away for ~45–75 minutes.
   - The notebook synthesises thousands of "Orac" / "Hey Orac" samples
     (including British English voices), augments them with noise and room
     acoustics, and trains the classifier against a large negative corpus.
4. The last cell downloads `orac_wake_models.zip`. Unzip it and drop ALL
   THREE .onnx files into `public/models/` in this repo. Commit and push.
5. The app auto-detects `public/models/orac.onnx` and switches the wake
   engine — no code changes needed. The old Whisper detector remains as
   the automatic fallback if the files are absent.

## Tuning after first use

- Misses too often → retrain with `n_samples: 8000` (more variety), or
  lower `WAKE_SCORE_THRESHOLD` in `lib/voice/oww-detector.ts` (default 0.5).
- False wakes → raise the threshold to 0.6–0.7 first; retrain only if that
  isn't enough.
- 2–3 training iterations is normal for a production-quality wake word.

## If a notebook step errors

openWakeWord's training pipeline occasionally moves. The upstream source of
truth is the official notebook:
https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb
— our config (target phrases, British voices, sample counts) transfers
directly; paste it into their current notebook if needed.

## After training completes (self-contained — no chat context needed)

> Note: cell 5 may end with `ModuleNotFoundError: No module named 'onnx_tf'`.
> That is the optional ONNX→TFLite conversion at the very end of train.py —
> we only use the ONNX file, which is already written to
> `/content/orac_model/orac.onnx` by that point (the log shows
> "Translate the graph into ONNX... ✅" first). Ignore it and continue.

> Note: newer torch exporters write the classifier as `orac.onnx` (graph,
> ~14KB) + `orac.onnx.data` (weights). The browser needs ONE self-contained
> file — cell 6 merges them automatically. If you ever grab the file
> manually and it's only a few KB, merge first:
> `m = onnx.load(path); convert_model_from_external_data(m); onnx.save(m, out)`
> (from `onnx.external_data_helper`). A healthy merged orac.onnx is >100KB.

### 1. Get the models out of Colab
- Run **cell 6** → downloads `orac_wake_models.zip`.
- If cell 6 errors on the bundle step, the three files can be collected
  manually from the Colab file browser:
  - `/content/orac_model/orac.onnx` (search `orac.onnx` under /content/orac_model)
  - `/content/openWakeWord/openwakeword/resources/models/melspectrogram.onnx`
  - `/content/openWakeWord/openwakeword/resources/models/embedding_model.onnx`

### 2. Deploy
```bash
# unzip, then from the repo root:
cp ~/Downloads/orac.onnx ~/Downloads/melspectrogram.onnx ~/Downloads/embedding_model.onnx public/models/
git add public/models && git commit -m "Add trained Orac wake model" && git push
```
Also bump `MODELS_VERSION` in `lib/voice/oww-detector.ts` (cache-buster —
browsers that cached the previous .onnx would otherwise fail with
"protobuf parsing failed"). Wait for the Vercel deploy to go green.

### 3. Test
1. Open EngineAI, hard-reload the tab.
2. Click the Orac pill to arm. First arm downloads ~3MB (progress in the
   pill). There is NO enrollment step with the trained engine — it goes
   straight to listening. (The ⚙ tune button disappears: that's expected,
   it belongs to the old whisper engine.)
3. Say "Orac" → chime + "Yes?". Say "Orac, what meetings have I had
   today?" in one breath → chime, then it answers directly (the spoken
   command audio is flushed into the session).
4. The floating readout shows the live classifier score (0–100%).
   Ambient noise should idle near 0; a deliberate "Orac" should spike.

### 4. Tune (one number)
`WAKE_SCORE_THRESHOLD` in `lib/voice/oww-detector.ts` (default 0.5):
- False wakes → raise to 0.6–0.7.
- Misses → lower to 0.4, or retrain with `n_samples: 8000`.

### Hands-free smoke test (no human voice needed)
With the page armed, play a synthesized wake word through the speakers:
`say -v Daniel "orack"` (macOS, en-GB voice). The mic picks it up and the
wake should fire (verified 2026-06-11: scores ~0.68 vs threshold 0.5).
The en-US voices score near 0 — the model is pronunciation-sensitive,
which is expected and good.

### 5. If arming shows an error
Open the browser console (View → Developer → JavaScript Console) and look
for `[OwwDetector]` lines. Most likely cause on first run: a tensor-shape
mismatch between the trained classifier and the engine's constants
(`MEL_WINDOW`/`MEL_STEP`/`EMB_WINDOW`/`EMB_DIM` in
`lib/voice/oww-detector.ts` — sized for total_length 32000 = 16
embeddings × 96 dims). Give the console output + this note to Claude.

### Rollback
Delete the three files from `public/models/` and push — the app
automatically falls back to the previous Whisper-based detector
(enrollment via the ⚙ button).

### Architecture context for future sessions
- Voice roadmap: `docs/voice-roadmap.md`
- Wake engine (trained): `lib/voice/oww-detector.ts`
- Wake engine (fallback): `lib/voice/wake-detector.ts` + `lib/voice/mel.ts`
- UI/arming: `components/ai-writer/WakeMode.tsx`
- Conversation dock: `components/ai-writer/VoiceDock.tsx`
- Voice session backend: `app/api/ai/voice/*`, config in `lib/ai/voice.ts`
