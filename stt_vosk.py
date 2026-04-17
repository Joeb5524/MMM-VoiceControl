import argparse
import json
import subprocess
import sys
import time

from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def emit_error(code, message, detail=""):
    emit({
        "type": "error",
        "code": code,
        "message": message,
        "detail": detail
    })


def start_capture_process(device, mic_command):
    cmd = [mic_command, "-q"]
    if device:
        cmd += ["-D", device]
    cmd += ["-c", "1", "-r", "16000", "-f", "S16_LE", "-t", "raw"]

    return subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )


def build_recognizer(model, phrases):
    grammar = phrases if phrases else ["next screen"]
    return KaldiRecognizer(model, 16000, json.dumps(grammar))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--wake", default="mirror")
    parser.add_argument("--commands_json", required=True)
    parser.add_argument("--window_ms", type=int, default=4000)
    parser.add_argument("--device", default="default")
    parser.add_argument("--mic_command", default="arecord")
    args = parser.parse_args()

    try:
        model = Model(args.model)
    except Exception as exc:
        emit_error("MODEL_LOAD_FAILED", "Unable to load the Vosk model.", str(exc))
        return

    try:
        commands = json.loads(args.commands_json)
    except json.JSONDecodeError as exc:
        emit_error("COMMANDS_INVALID", "Unable to parse the command grammar.", str(exc))
        return

    wake = args.wake.strip().lower()
    commands = [str(command).strip().lower() for command in commands if str(command).strip()]
    if not commands:
        commands = ["next screen"]

    try:
        proc = start_capture_process(args.device, args.mic_command)
    except FileNotFoundError as exc:
        emit_error("MIC_COMMAND_NOT_FOUND", "Unable to start microphone capture.", str(exc))
        return
    except Exception as exc:
        emit_error("MIC_START_FAILED", "Unable to access microphone capture.", str(exc))
        return

    wake_recognizer = build_recognizer(model, [wake])
    command_recognizer = None
    active_recognizer = wake_recognizer

    stage = "wake"
    command_deadline_ms = 0

    emit({"type": "ready"})
    emit({"type": "status", "state": "listening_wake"})

    try:
        while True:
            chunk = proc.stdout.read(4000)
            if not chunk:
                if proc.poll() is not None:
                    stderr_output = proc.stderr.read().decode("utf-8", errors="ignore").strip()
                    raise RuntimeError(stderr_output or f"{args.mic_command} exited unexpectedly.")

                time.sleep(0.01)
                continue

            now_ms = int(time.time() * 1000)
            if stage == "cmd" and now_ms > command_deadline_ms:
                stage = "wake"
                wake_recognizer = build_recognizer(model, [wake])
                command_recognizer = None
                active_recognizer = wake_recognizer
                emit({"type": "status", "state": "listening_wake"})

            if active_recognizer.AcceptWaveform(chunk):
                result = json.loads(active_recognizer.Result() or "{}")
                text = (result.get("text") or "").strip().lower()
                if not text:
                    continue

                if stage == "wake":
                    if wake in text:
                        stage = "cmd"
                        command_deadline_ms = now_ms + args.window_ms
                        command_recognizer = build_recognizer(model, commands)
                        active_recognizer = command_recognizer
                        emit({"type": "status", "state": "listening_cmd"})
                    continue

                emit({"type": "command", "text": text})
                stage = "wake"
                wake_recognizer = build_recognizer(model, [wake])
                command_recognizer = None
                active_recognizer = wake_recognizer
                emit({"type": "status", "state": "listening_wake"})
    except KeyboardInterrupt:
        return
    except Exception as exc:
        emit_error("VOICE_RUNTIME_FAILED", "Voice recognition stopped unexpectedly.", str(exc))
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    main()
