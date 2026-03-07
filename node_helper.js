const NodeHelper = require("node_helper");
const { spawn } = require("child_process");
const path = require("path");

module.exports = NodeHelper.create({
    start() {
        this.proc = null;
        this.listening = false;
        this.state = "idle";
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MVC_START") {
            if (this.proc) return;

            const modelDir = payload.modelDir;
            const wakeWord = payload.wakeWord;
            const commandWindowMs = payload.commandWindowMs;
            const device = payload.device || "default";
            const commands = Array.isArray(payload.commands) ? payload.commands : [];

            this._startVosk(modelDir, wakeWord, commandWindowMs, device, commands);
            return;
        }

        if (notification === "MVC_STOP") {
            this._stopVosk();
        }
    },

    _startVosk(modelDir, wakeWord, commandWindowMs, device, commands) {
        const py = path.join(__dirname, "stt_vosk.py");

        this.proc = spawn("python3", [
            py,
            "--model", modelDir,
            "--wake", wakeWord,
            "--window", String(commandWindowMs),
            "--device", device,
            "--commands", JSON.stringify(commands)
        ]);

        this.listening = true;
        this.state = "listening_wake";
        this.sendSocketNotification("MVC_STATUS", { listening: this.listening, state: this.state });

        this.proc.stdout.on("data", (data) => {
            const line = String(data).trim();
            if (!line) return;

            try {
                const msg = JSON.parse(line);

                if (msg.type === "status") {
                    this.state = msg.state || this.state;
                    this.sendSocketNotification("MVC_STATUS", { listening: true, state: this.state });
                    return;
                }

                if (msg.type === "heard") {
                    this.sendSocketNotification("MVC_HEARD", { text: msg.text || "" });
                    return;
                }

                if (msg.type === "intent") {
                    const mapped = this._mapIntent(msg.text || "");
                    if (mapped) {
                        this.sendSocketNotification("MVC_INTENT", { intent: mapped.intent, text: msg.text, ...mapped.payload });
                    }
                }
            } catch (_) {

            }
        });

        this.proc.on("close", () => {
            this.proc = null;
            this.listening = false;
            this.state = "idle";
            this.sendSocketNotification("MVC_STATUS", { listening: false, state: "idle" });
        });
    },

    _stopVosk() {
        if (!this.proc) return;
        try { this.proc.kill("SIGTERM"); } catch (_) {}
        this.proc = null;
        this.listening = false;
        this.state = "idle";
        this.sendSocketNotification("MVC_STATUS", { listening: false, state: "idle" });
    },

    _mapIntent(text) {
        const t = String(text || "").trim().toLowerCase();


        if (t === "next screen") return { intent: "NEXT_SCREEN", payload: {} };
        if (t === "home screen") return { intent: "SET_SCREEN", payload: { screen: "home" } };
        if (t === "meds screen") return { intent: "SET_SCREEN", payload: { screen: "meds" } };
        if (t === "care screen") return { intent: "SET_SCREEN", payload: { screen: "care" } };

        if (t === "acknowledge alert") return { intent: "ACK_ALERT", payload: {} };
        if (t === "dismiss alert") return { intent: "DISMISS_ALERT", payload: {} };
        if (t === "medication taken") return { intent: "MED_TAKEN", payload: {} };

        if (t === "stop music" || t === "pause music") return { intent: "MUSIC_STOP", payload: {} };
        if (t.startsWith("play ")) return { intent: "MUSIC_PLAY_QUERY", payload: { query: t.replace(/^play\s+/, "") } };

        // Hue mappings
        if (t === "lights on") return { intent: "HUE_COMMAND", payload: { hue: { action: "on", target: "all" } } };
        if (t === "lights off") return { intent: "HUE_COMMAND", payload: { hue: { action: "off", target: "all" } } };
        if (t === "toggle lights") return { intent: "HUE_COMMAND", payload: { hue: { action: "toggle", target: "all" } } };

        if (t === "set lights red") return { intent: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#ff0000" } } };
        if (t === "set lights green") return { intent: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#00ff00" } } };
        if (t === "set lights blue") return { intent: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#0000ff" } } };
        if (t === "set lights white") return { intent: "HUE_COMMAND", payload: { hue: { action: "color", target: "all", rgb: "#ffffff" } } };

        return null;
    }
});
