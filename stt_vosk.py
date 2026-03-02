import argparse
import json
import subprocess
import sys
import time

from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)

def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def start_arecord(device: str):
    cmd = ["arecord", "-q"]
    if device:
        cmd += ["-D", device]
    cmd += ["-c", "1", "-r", "16000", "-f", "S16_LE", "-t", "raw"]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--wake", default="mirror")
    ap.add_argument("--commands_json", required=True)
    ap.add_argument("--window_ms", type=int, default=4000)
    ap.add_argument("--device", default="default")
    args = ap.parse_args()

    model = Model(args.model)

    wake = args.wake.strip().lower()
    commands = json.loads(args.commands_json)
    commands = [str(c).strip().lower() for c in commands if str(c).strip()]

    wake_rec = KaldiRecognizer(model, 16000, json.dumps([wake]))
    cmd_rec  = KaldiRecognizer(model, 16000, json.dumps(commands if commands else ["next screen"]))

    proc = start_arecord(args.device)

    stage = "wake"
    cmd_deadline = 0

    emit({"type": "status", "state": "listening_wake"})

    try:
        while True:
            chunk = proc.stdout.read(4000)
            if not chunk:
                time.sleep(0.01)
                continue

            now = int(time.time() * 1000)
            if stage == "cmd" and now > cmd_deadline:
                stage = "wake"
                emit({"type": "status", "state": "listening_wake"})

            rec = wake_rec if stage == "wake" else cmd_rec

            if rec.AcceptWaveform(chunk):
                res = json.loads(rec.Result() or "{}")
                text = (res.get("text") or "").strip().lower()
                if not text:
                    continue

                if stage == "wake":
                    if wake in text:
                        stage = "cmd"
                        cmd_deadline = now + args.window_ms
                        emit({"type": "wake"})
                        emit({"type": "status", "state": "listening_cmd"})
                    continue

                emit({"type": "command", "text": text})
                stage = "wake"
                emit({"type": "status", "state": "listening_wake"})
    except KeyboardInterrupt:
        pass
    finally:
        try:
            proc.terminate()
        except Exception:
            pass

if __name__ == "__main__":
    main()