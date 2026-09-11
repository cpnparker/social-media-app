# Wake-word models

Drop the three files from `orac_wake_models.zip` here (produced by
`scripts/wake-training/orac_training_colab.ipynb`):

- `orac.onnx`
- `melspectrogram.onnx`
- `embedding_model.onnx`

The app detects `orac.onnx` automatically and switches the wake engine from
the Whisper fallback to the trained openWakeWord pipeline. Remove the files
to switch back.
