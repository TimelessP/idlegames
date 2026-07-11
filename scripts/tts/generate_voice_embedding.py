#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import numpy as np
from safetensors.numpy import save_file


def load_audio(path: Path) -> np.ndarray:
    try:
        import librosa
    except ImportError as exc:
        raise SystemExit("librosa is required. Install it with `pip install librosa`.") from exc

    audio, sr = librosa.load(path, sr=24000, mono=True, dtype=np.float32)
    return audio.astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate a Pocket TTS voice embedding from an audio sample.')
    parser.add_argument('--input', required=True, help='Path to a WAV/FLAC/OGG audio file')
    parser.add_argument('--output', required=True, help='Output path for the .safetensors voice embedding')
    parser.add_argument('--model', default='assets/vendor/tts/pocket-tts/onnx/english_2026-04/mimi_encoder_int8.onnx')
    parser.add_argument('--metadata', default='assets/vendor/tts/pocket-tts/onnx/english_2026-04/bundle.json')
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    model_path = Path(args.model).resolve()
    metadata_path = Path(args.metadata).resolve()

    if not input_path.exists():
        raise SystemExit(f'Input audio file not found: {input_path}')
    if not model_path.exists():
        raise SystemExit(f'Model file not found: {model_path}')
    if not metadata_path.exists():
        raise SystemExit(f'Metadata file not found: {metadata_path}')

    audio = load_audio(input_path)
    if len(audio) < 16000:
        raise SystemExit('Audio sample must be at least 0.66s long')

    import onnxruntime as ort
    session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
    audio_tensor = np.expand_dims(audio, axis=0)
    audio_tensor = np.expand_dims(audio_tensor, axis=0)
    inputs = {session.get_inputs()[0].name: audio_tensor}
    outputs = session.run(None, inputs)
    embedding = np.asarray(outputs[0], dtype=np.float32)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_file({'embedding': embedding}, str(output_path))

    print(json.dumps({
        'input': str(input_path),
        'output': str(output_path),
        'shape': list(embedding.shape),
    }))


if __name__ == '__main__':
    main()
