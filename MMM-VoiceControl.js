/* global Module */

Module.register("MMM-VoiceControl", {
    defaults: {
        modelDir: "models/vosk-model-small-en-us-0.15",
        wakeWord: "mirror",
        commandWindowMs: 4000,
        device: "default",


        listenWhenShownOnly: false,

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
    },

    start() {
        this.state = "idle";
        this.listening = false;
        this.last = "";
        this._started = false;
    },

    getStyles() {
        return ["MMM-VoiceControl.css"];
    },

    suspend() {
        if (this.config.listenWhenShownOnly) this._stop();
    },

    resume() {
        if (this.config.listenWhenShownOnly) this._start();
    },

    notificationReceived(notification) {
        if (notification === "DOM_OBJECTS_CREATED") this._start();
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MVC_STATUS") {
            this.state = (payload && payload.state) ? payload.state : "idle";
            this.listening = !!(payload && payload.listening);
            this.updateDom(0);
            return;
        }

        if (notification === "MVC_HEARD") {
            this.last = String(payload && payload.text ? payload.text : "");
            this.state = "heard";
            this.updateDom(0);

            setTimeout(() => {
                this.state = this.listening ? "listening_wake" : "idle";
                this.updateDom(0);
            }, 1200);

            return;
        }

        if (notification === "MVC_INTENT") {
            const intent = String(payload && payload.intent ? payload.intent : "");
            this.last = String(payload && payload.text ? payload.text : intent);
            this.state = "heard";
            this.updateDom(0);

            if (intent === "NEXT_SCREEN") {
                this.sendNotification("ASSIST_TOUCH_NEXT_SCREEN", {});
            }

            if (intent === "SET_SCREEN" && payload && payload.screen) {
                this.sendNotification("ASSIST_SCREEN_SET", { screen: payload.screen });
            }

            if (intent === "ACK_ALERT") {
                this.sendNotification("SR_ACK_ACTIVE_REQUEST", {});
            }

            if (intent === "DISMISS_ALERT") {
                this.sendNotification("SR_DISMISS_ACTIVE_REQUEST", {});
            }

            if (intent === "MED_TAKEN") {
                this.sendNotification("MED_MARK_NEXT_DUE_TAKEN", {});
            }

            if (intent === "MUSIC_PLAY_QUERY") {
                this.sendNotification("MUSIC_PLAY_QUERY", { query: payload.query || "" });
            }

            if (intent === "MUSIC_STOP") {
                this.sendNotification("MUSIC_STOP", {});
            }

            if (intent === "HUE_COMMAND" && payload && payload.hue) {
                this.sendNotification("HUE_COMMAND", payload.hue);
            }

            setTimeout(() => {
                this.state = this.listening ? "listening_wake" : "idle";
                this.updateDom(0);
            }, 1200);

            return;
        }
    },

    _start() {
        if (this._started) return;
        this._started = true;

        this.sendSocketNotification("MVC_START", {
            modelDir: this.config.modelDir,
            wakeWord: this.config.wakeWord,
            commandWindowMs: this.config.commandWindowMs,
            device: this.config.device,
            commands: this.config.commands
        });
    },

    _stop() {
        this._started = false;
        this.sendSocketNotification("MVC_STOP", {});
    },

    getDom() {
        const root = document.createElement("div");
        root.className = "mvc-root";

        const pill = document.createElement("div");
        pill.className = `mvc-pill mvc-pill--${this.state}`;

        if (this.state === "idle") {
            pill.style.display = "none";
        } else if (this.state === "listening_wake") {
            pill.textContent = `Say "${this.config.wakeWord}"`;
        } else if (this.state === "listening_cmd") {
            pill.textContent = "Listening…";
        } else if (this.state === "heard") {
            pill.textContent = this.last ? `✓ ${this.last}` : "✓";
        } else {
            pill.textContent = "Voice unavailable";
        }

        root.appendChild(pill);
        return root;
    }
});