/* global Module */

Module.register("MMM-VoiceControl", {
    defaults: {
        modelDir: "models/vosk-model-small-en-us-0.15",
        wakeWord: "mirror",
        commandWindowMs: 4000,
        device: "default",
        listenWhenShownOnly: true,
        commands: [
            "next screen",
            "home screen",
            "meds screen",
            "care screen",
            "acknowledge alert",
            "dismiss alert"
        ]
    },

    start() {
        this.state = "idle";
        this.listening = false;
        this.last = "";
    },

    getStyles() {
        return ["MMM-VoiceControl.css"];
    },

    suspend() {
        if (this.config.listenWhenShownOnly) this._stop();
    },

    resume() {
        this._start();
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

            if (intent === "NEXT_SCREEN") this.sendNotification("ASSIST_TOUCH_NEXT_SCREEN", {});
            if (intent === "SET_SCREEN" && payload && payload.screen) this.sendNotification("ASSIST_SCREEN_SET", { screen: payload.screen });

            if (intent === "ACK_ALERT") this.sendNotification("SR_ACK_ACTIVE_REQUEST", {});
            if (intent === "DISMISS_ALERT") this.sendNotification("SR_DISMISS_ACTIVE_REQUEST", {});

            setTimeout(() => {
                this.state = this.listening ? "listening_wake" : "idle";
                this.updateDom(0);
            }, 1200);
        }
    },

    _start() {
        if (this.listening) return;
        this.sendSocketNotification("MVC_START", {
            modelDir: this.config.modelDir,
            wakeWord: this.config.wakeWord,
            commandWindowMs: this.config.commandWindowMs,
            device: this.config.device,
            commands: this.config.commands
        });
    },

    _stop() {
        if (!this.listening) return;
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