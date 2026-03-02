const NodeHelper = require("node_helper");
const path = require("path");
const { spawn } = require("child_process");

module.exports = NodeHelper.create({
    start() {
        this.proc = null;
        this.listening = false;

        this.cfg = {
            modelDir: "models/vosk-model-small-en-us-0.15",
            wakeWord: "mirror",
            commandWindowMs: 4000,
            device: "default",
            commands: [
                "next screen",
                "home screen",
                "meds screen",
                "care screen",
                "acknowledge alert",
                "dismiss alert"
            ]
        };
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MVC_START") {
            this.cfg = { ...this.cfg, ...(payload || {}) };
            this._start();
            return;
        }
        if (notification === "MVC_STOP") {
            this._stop();
        }
    },

    _start() {
        if (this.proc) return;

        const venvPy = path.join(__dirname, ".venv", "bin", "python3");
        const script = path.join(__dirname, "stt_vosk.py");

        const modelPath = path.isAbsolute(this.cfg.modelDir)
            ? this.cfg.modelDir
            : path.join(__dirname, this.cfg.modelDir);

        const args = [
            script,
            "--model", modelPath,
            "--wake", String(this.cfg.wakeWord || "mirror"),
            "--commands_json", JSON.stringify(this.cfg.commands || []),
            "--window_ms", String(Number(this.cfg.commandWindowMs || 4000)),
            "--device", String(this.cfg.device || "default")
        ];

        this.proc = spawn(venvPy, args, { stdio: ["ignore", "pipe", "pipe"] });

        this.proc.stdout.on("data", (buf) => this._onStdout(buf));
        this.proc.stderr.on("data", () => {});

        this.proc.on("close", () => {
            this.proc = null;
            this.listening = false;
            this.sendSocketNotification("MVC_STATUS", { state: "idle", listening: false });
        });

        this.listening = true;
        this.sendSocketNotification("MVC_STATUS", { state: "listening_wake", listening: true });
    },

    _stop() {
        if (!this.proc) return;
        try { this.proc.kill("SIGTERM"); } catch (_) {}
        this.proc = null;
        this.listening = false;
        this.sendSocketNotification("MVC_STATUS", { state: "idle", listening: false });
    },

    _onStdout(buf) {
        const lines = String(buf).split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            let msg;
            try { msg = JSON.parse(line); } catch (_) { continue; }

            if (msg.type === "status") {
                this.sendSocketNotification("MVC_STATUS", {
                    state: msg.state || "idle",
                    listening: true
                });
                continue;
            }

            if (msg.type === "wake") {
                // optional future: play a beep
                continue;
            }

            if (msg.type === "command") {
                const text = String(msg.text || "").toLowerCase();
                const intent = this._mapIntent(text);
                if (intent) {
                    this.sendSocketNotification("MVC_INTENT", { intent: intent.type, text, ...intent.payload });
                } else {
                    this.sendSocketNotification("MVC_HEARD", { text });
                }
            }
        }
    },

    _mapIntent(text) {
        if (text === "next screen") return { type: "NEXT_SCREEN", payload: {} };
        if (text === "home screen") return { type: "SET_SCREEN", payload: { screen: "home" } };
        if (text === "meds screen") return { type: "SET_SCREEN", payload: { screen: "meds" } };
        if (text === "care screen") return { type: "SET_SCREEN", payload: { screen: "care" } };
        if (text === "acknowledge alert") return { type: "ACK_ALERT", payload: {} };
        if (text === "dismiss alert") return { type: "DISMISS_ALERT", payload: {} };
        return null;
    }
});