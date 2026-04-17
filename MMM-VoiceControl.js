/* global Module */

Module.register("MMM-VoiceControl", {
    defaults: {
        modelDir: "models/vosk-model-small-en-us-0.15",
        wakeWord: "mirror",
        commandWindowMs: 4000,
        device: "default",
        pythonPath: "",
        micCommand: "arecord",
        listenWhenShownOnly: false,
        restartDelayMs: 1500,
        enabledCommands: [],
        hintCount: 3,
        displayMode: "region",
        overlayMode: null
    },

    start() {
        this._started = false;
        this._feedbackTimer = null;
        this._renderSignature = "";
        this._commandApi = null;

        this.health = "ready";
        this.stage = "idle";
        this.listening = false;
        this.error = null;
        this.lastHeard = "";
        this.lastCommandId = "";
        this.feedback = "";
        this.commandWindowMs = this.config.commandWindowMs;
    },

    getScripts() {
        return ["voice_commands.js"];
    },

    getStyles() {
        return ["MMM-VoiceControl.css"];
    },

    suspend() {
        if (this.config.listenWhenShownOnly) {
            this._stop();
        }
    },

    resume() {
        if (this.config.listenWhenShownOnly) {
            this._start();
        }
    },

    notificationReceived(notification) {
        if (notification === "DOM_OBJECTS_CREATED") {
            this._start();
        }
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MVC_STATE") {
            this._applyHelperState(payload);
            return;
        }

        if (notification === "MVC_COMMAND") {
            this._handleCommand(payload);
        }
    },

    _start() {
        if (this._started) {
            return;
        }

        this._started = true;
        this._setViewState({
            health: "starting",
            stage: "idle",
            listening: false,
            error: null,
            commandWindowMs: this.config.commandWindowMs
        });

        this.sendSocketNotification("MVC_START", {
            modelDir: this.config.modelDir,
            wakeWord: this.config.wakeWord,
            commandWindowMs: this.config.commandWindowMs,
            device: this.config.device,
            pythonPath: this.config.pythonPath,
            micCommand: this.config.micCommand,
            restartDelayMs: this.config.restartDelayMs,
            enabledCommands: this.config.enabledCommands,
            commands: this.config.commands
        });
    },

    _stop() {
        this._started = false;
        this.sendSocketNotification("MVC_STOP", {});
        this._setViewState({
            health: "ready",
            stage: "idle",
            listening: false,
            error: null
        });
    },

    _applyHelperState(payload) {
        this._setViewState({
            health: payload && payload.health ? payload.health : "ready",
            stage: payload && payload.stage ? payload.stage : "idle",
            listening: !!(payload && payload.listening),
            error: payload && payload.error ? payload.error : null,
            commandWindowMs: payload && payload.commandWindowMs ? payload.commandWindowMs : this.config.commandWindowMs
        });
    },

    _handleCommand(payload) {
        const recognized = !!(payload && payload.recognized);
        const command = recognized ? this._findCommandById(payload.commandId) : null;

        this.lastCommandId = command ? command.id : "";
        this.lastHeard = payload && payload.text
            ? String(payload.text)
            : command
                ? command.phrase
                : "";
        this.feedback = recognized ? "success" : "warning";
        this._scheduleFeedbackClear();

        if (command) {
            this._dispatchCommand(command);
        }

        this._requestRender();
    },

    _dispatchCommand(command) {
        const notifications = Array.isArray(command.notifications) ? command.notifications : [];

        notifications.forEach((entry) => {
            this.sendNotification(entry.notification, this._clone(entry.payload || {}));
        });
    },

    _scheduleFeedbackClear() {
        if (this._feedbackTimer) {
            clearTimeout(this._feedbackTimer);
        }

        this._feedbackTimer = setTimeout(() => {
            this.feedback = "";
            this._requestRender();
        }, 1800);
    },

    _setViewState(nextState) {
        let changed = false;
        const fields = ["health", "stage", "listening", "commandWindowMs"];

        fields.forEach((field) => {
            if (typeof nextState[field] !== "undefined" && this[field] !== nextState[field]) {
                this[field] = nextState[field];
                changed = true;
            }
        });

        const nextError = nextState.error ? JSON.stringify(nextState.error) : "";
        const currentError = this.error ? JSON.stringify(this.error) : "";
        if (nextError !== currentError) {
            this.error = nextState.error || null;
            changed = true;
        }

        if (changed) {
            this._requestRender();
        }
    },

    _requestRender() {
        const signature = JSON.stringify({
            health: this.health,
            stage: this.stage,
            listening: this.listening,
            error: this.error,
            lastHeard: this.lastHeard,
            lastCommandId: this.lastCommandId,
            feedback: this.feedback,
            displayMode: this._getDisplayMode(),
            commandWindowMs: this.commandWindowMs,
            hints: this._getHintPhrases()
        });

        if (signature === this._renderSignature) {
            return;
        }

        this._renderSignature = signature;
        this.updateDom(0);
    },

    _getCommandApi() {
        if (!this._commandApi && typeof globalThis !== "undefined" && globalThis.MVCVoiceCommands) {
            this._commandApi = globalThis.MVCVoiceCommands;
        }

        return this._commandApi;
    },

    _findCommandById(commandId) {
        const api = this._getCommandApi();
        return api ? api.findCommandById(commandId, this.config) : null;
    },

    _getHintPhrases() {
        const api = this._getCommandApi();
        return api ? api.getHintPhrases(this.config, this.config.hintCount) : [];
    },

    _getDisplayMode() {
        if (typeof this.config.overlayMode === "boolean") {
            return this.config.overlayMode ? "overlay" : "region";
        }

        return this.config.displayMode === "overlay" ? "overlay" : "region";
    },

    _getStatusCopy() {
        if (this.health === "error") {
            return {
                eyebrow: "Voice offline",
                title: "Check the speech worker",
                detail: this.error && this.error.message
                    ? this.error.message
                    : "Voice control could not start."
            };
        }

        if (this.health === "restarting") {
            return {
                eyebrow: "Recovering",
                title: "Restarting voice control",
                detail: this.error && this.error.message
                    ? this.error.message
                    : "Reconnecting to the microphone."
            };
        }

        if (this.health === "starting") {
            return {
                eyebrow: "Starting",
                title: "Preparing voice control",
                detail: "Checking Python, model, and microphone."
            };
        }

        if (this.health === "listening" && this.stage === "command") {
            return {
                eyebrow: "Live command window",
                title: "Listening for a command",
                detail: "Speak clearly before the timer completes."
            };
        }

        if (this.health === "listening" && this.stage === "wake") {
            return {
                eyebrow: "Wake word active",
                title: `Say "${this.config.wakeWord}"`,
                detail: "Voice control is waiting for the wake word."
            };
        }

        return {
            eyebrow: "Ready",
            title: "Voice control ready",
            detail: `Say "${this.config.wakeWord}" to begin.`
        };
    },

    _getStatusBadge() {
        if (this.health === "error") {
            return "error";
        }

        if (this.health === "restarting") {
            return "restarting";
        }

        if (this.health === "starting") {
            return "starting";
        }

        if (this.stage === "command") {
            return "listening";
        }

        if (this.stage === "wake") {
            return "wake";
        }

        return "ready";
    },

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    },

    getDom() {
        const copy = this._getStatusCopy();
        const root = document.createElement("div");
        root.className = `mvc-root mvc-root--${this._getDisplayMode()}`;

        const card = document.createElement("section");
        card.className = [
            "mvc-card",
            `mvc-card--health-${this.health}`,
            `mvc-card--stage-${this.stage}`,
            this.feedback ? `mvc-card--feedback-${this.feedback}` : ""
        ].filter(Boolean).join(" ");
        card.style.setProperty("--mvc-command-window-ms", `${this.commandWindowMs}ms`);

        const header = document.createElement("div");
        header.className = "mvc-header";

        const status = document.createElement("div");
        status.className = "mvc-status";

        const dot = document.createElement("span");
        dot.className = "mvc-dot";

        const statusCopy = document.createElement("div");
        statusCopy.className = "mvc-status-copy";

        const eyebrow = document.createElement("div");
        eyebrow.className = "mvc-eyebrow";
        eyebrow.textContent = copy.eyebrow;

        const title = document.createElement("div");
        title.className = "mvc-title";
        title.textContent = copy.title;

        statusCopy.appendChild(eyebrow);
        statusCopy.appendChild(title);
        status.appendChild(dot);
        status.appendChild(statusCopy);

        const badge = document.createElement("div");
        badge.className = "mvc-badge";
        badge.textContent = this._getStatusBadge();

        header.appendChild(status);
        header.appendChild(badge);

        const detail = document.createElement("div");
        detail.className = "mvc-detail";
        detail.textContent = copy.detail;

        const transcript = document.createElement("div");
        transcript.className = "mvc-transcript";
        transcript.textContent = this.lastHeard || "No command heard yet.";

        const transcriptLabel = document.createElement("span");
        transcriptLabel.className = "mvc-transcript-label";
        transcriptLabel.textContent = "Last heard";
        transcript.prepend(transcriptLabel);

        card.appendChild(header);
        card.appendChild(detail);
        card.appendChild(transcript);

        if (this.stage === "command" && this.health === "listening") {
            const progress = document.createElement("div");
            progress.className = "mvc-progress";

            const progressBar = document.createElement("div");
            progressBar.className = "mvc-progress-bar";

            const progressLabel = document.createElement("div");
            progressLabel.className = "mvc-progress-label";
            progressLabel.textContent = `${(this.commandWindowMs / 1000).toFixed(1)}s response window`;

            progress.appendChild(progressBar);
            card.appendChild(progress);
            card.appendChild(progressLabel);
        }

        if ((this.health === "ready" || this.stage === "wake") && !this.error) {
            const hints = this._getHintPhrases();
            if (hints.length) {
                const hintRow = document.createElement("div");
                hintRow.className = "mvc-hints";

                hints.forEach((hint) => {
                    const chip = document.createElement("span");
                    chip.className = "mvc-hint";
                    chip.textContent = hint;
                    hintRow.appendChild(chip);
                });

                card.appendChild(hintRow);
            }
        }

        if (this.error && this.error.detail) {
            const meta = document.createElement("div");
            meta.className = "mvc-meta";
            meta.textContent = this.error.detail;
            card.appendChild(meta);
        }

        root.appendChild(card);
        return root;
    }
});
