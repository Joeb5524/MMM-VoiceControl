# MMM-VoiceControl

Offline wake-word voice control for MagicMirror using Python Vosk.

## Runtime path

This module uses a Python speech worker and the Python `vosk` package.

## Requirements

- Python 3
- `arecord` from ALSA for microphone capture
- A Vosk model in `models/`

## Setup

1. Create a local virtual environment if you want the module to self-discover Python:

```bash
python3 -m venv .venv
```

2. Install the Python dependency:

```bash
.venv/bin/python3 -m pip install -r requirements.txt
```

3. Ensure `arecord` is available:

```bash
arecord --version
```

4. Start MagicMirror. The helper validates Python, the Vosk import, the model path, and the microphone command before the worker starts.

## Configuration

```js
{
    module: "MMM-VoiceControl",
    position: "top_right",
    config: {
        wakeWord: "mirror",
        modelDir: "models/vosk-model-small-en-us-0.15",
        displayMode: "region",
        pythonPath: "",
        micCommand: "arecord",
        commandWindowMs: 4000,
        enabledCommands: [],
        hintCount: 3
    }
}
```

### Options

- `displayMode`: `"region"` by default. Set to `"overlay"` for a floating badge/card.
- `pythonPath`: Optional absolute path or command name for Python. If empty, the helper tries `.venv/bin/python3`, `.venv/Scripts/python.exe`, `python3`, then `python`.
- `micCommand`: Capture command used by the Python worker. Defaults to `arecord`.
- `enabledCommands`: Optional allow-list of command ids, intents, or phrases.
- `hintCount`: Number of example command chips shown while idle.

## Shared command registry

Commands now live in `voice_commands.js`. The module derives these from that single registry:

- Recognizer grammar
- UI hint chips
- Command lookup
- MagicMirror notification dispatch

To add a command, update the registry entry once with:

- `phrase`
- `aliases`
- `intent`
- `payload`
- `notifications`

## Health states

The frontend renders explicit helper health:

- `starting`
- `ready`
- `listening`
- `restarting`
- `error`

If startup fails, the card shows the validation error from the helper instead of silently falling back to idle.
