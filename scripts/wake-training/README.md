# Training the "Orac" wake-word model (openWakeWord)

One-time, ~1 hour on a free Google Colab GPU, £0.

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
