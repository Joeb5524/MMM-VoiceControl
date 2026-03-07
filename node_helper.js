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
                "dismiss alert",
                "medication taken",
                "play calm music",
                "play sleep music",
                "play morning music",
                "play exercise music",
                "play music",
                "stop music",
                "pause music",
                "lights on",
                "lights off",
                "toggle lights",
                "set lights red",
                "set lights green",
                "set lights blue",
                "set lights white"
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
                continue;
            }

            if (msg.type === "command") {
                const text = String(msg.text || "").toLowerCase();
                const intent = this._mapIntent(text);

                if (intent) {
                    this.sendSocketNotification("MVC_INTENT", {
                        intent: intent.type,
                        text,
                        ...intent.payload
                    });
                } else {
                    this.sendSocketNotification("MVC_HEARD", { text });
                }
            }
        }
    },

    _mapIntent(text) {
        if (text === "next screen") return { type: "NEXT_SCREEN", payload: {} };
        if (text.includes("home")) return { type: "SET_SCREEN", payload: { screen: "home" } };
        if (text === "meds screen") return { type: "SET_SCREEN", payload: { screen: "meds" } };
        if (text === "care screen") return { type: "SET_SCREEN", payload: { screen: "care" } };
        if (text === "acknowledge alert") return { type: "ACK_ALERT", payload: {} };
        if (text === "dismiss alert") return { type: "DISMISS_ALERT", payload: {} };
        if (text.includes("medication taken")) return { type: "MED_TAKEN", payload: {} };

        if (text === "stop music" || text === "pause music") return { type: "MUSIC_STOP", payload: {} };
        if (text === "play music") return { type: "MUSIC_PLAY_QUERY", payload: { query: "music" } };
        if (text === "play calm music") return { type: "MUSIC_PLAY_QUERY", payload: { query: "calm" } };
        if (text === "play sleep music") return { type: "MUSIC_PLAY_QUERY", payload: { query: "sleep" } };
        if (text === "play morning music") return { type: "MUSIC_PLAY_QUERY", payload: { query: "morning" } };
        if (text === "play exercise music") return { type: "MUSIC_PLAY_QUERY", payload: { query: "exercise" } };

        if (text === "lights on") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "on", target: "all" } } };
        }
        if (text === "lights off") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "off", target: "all" } } };
        }
        if (text === "toggle lights") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "toggle", target: "all" } } };
        }
        if (text === "set lights red") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#ff0000" } } };
        }
        if (text === "set lights green") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#00ff00" } } };
        }
        if (text === "set lights blue") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#0000ff" } } };
        }
        if (text === "set lights white") {
            return { type: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#ffffff" } } };
        }

        return null;
    }
});