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
            return "Offline";
        }

        if (this.health === "restarting") {
            return "Recovering";
        }

        if (this.health === "starting") {
            return "Starting";
        }

        if (this.stage === "command") {
            return "Command";
        }

        if (this.stage === "wake") {
            return "Wake";
        }

        return "Ready";
    },

    _getActiveCommandCount() {
        const api = this._getCommandApi();
        return api ? api.getActiveCommands(this.config).length : null;
    },

    _getCommandCountCopy(count) {
        if (count === null) {
            return "Loading commands";
        }

        if (!count) {
            return "No commands armed";
        }

        return count === 1 ? "1 command armed" : `${count} commands armed`;
    },

    _getLastCommandPhrase() {
        if (!this.lastCommandId) {
            return "";
        }

        const command = this._findCommandById(this.lastCommandId);
        return command ? command.phrase : "";
    },

    _getOrbitCopy(activeCommandCount) {
        if (this.health === "error") {
            return {
                label: "Voice state",
                value: "Offline",
                detail: "Worker attention needed"
            };
        }

        if (this.health === "restarting") {
            return {
                label: "Voice state",
                value: "Retrying",
                detail: "Rebuilding microphone link"
            };
        }

        if (this.health === "starting") {
            return {
                label: "Voice state",
                value: "Booting",
                detail: "Checking local services"
            };
        }

        if (this.stage === "command") {
            return {
                label: "Listening live",
                value: "Speak now",
                detail: `${this._formatDuration(this.commandWindowMs)} response window`
            };
        }

        return {
            label: "Wake word",
            value: this.config.wakeWord,
            detail: this._getCommandCountCopy(activeCommandCount)
        };
    },

    _formatDuration(milliseconds) {
        const duration = Number.isFinite(milliseconds) ? milliseconds : this.config.commandWindowMs;
        return `${(duration / 1000).toFixed(1)}s`;
    },

    _createMetricCard(label, value, modifier) {
        const card = document.createElement("div");
        card.className = [
            "mvc-metric",
            "glass",
            modifier ? `mvc-metric--${modifier}` : ""
        ].filter(Boolean).join(" ");

        const metricLabel = document.createElement("span");
        metricLabel.className = "mvc-metric-label";
        metricLabel.textContent = label;

        const metricValue = document.createElement("span");
        metricValue.className = "mvc-metric-value";
        metricValue.textContent = value;

        card.appendChild(metricLabel);
        card.appendChild(metricValue);
        return card;
    },

    _createWaveBars() {
        const wave = document.createElement("div");
        wave.className = "mvc-wave";

        for (let index = 0; index < 5; index += 1) {
            const bar = document.createElement("span");
            bar.className = "mvc-wave-bar";
            wave.appendChild(bar);
        }

        return wave;
    },

    _clone(value) {
        return JSON.parse(JSON.stringify(value));
    },

    getDom() {
        const copy = this._getStatusCopy();
        const hints = this._getHintPhrases();
        const activeCommandCount = this._getActiveCommandCount();
        const commandCountCopy = this._getCommandCountCopy(activeCommandCount);
        const lastCommandPhrase = this._getLastCommandPhrase();
        const orbitCopy = this._getOrbitCopy(activeCommandCount);
        const transcriptText = this.lastHeard || "No command heard yet.";
        let transcriptNote = `Say "${this.config.wakeWord}" then one of the suggested commands.`;
        let transcriptNoteClass = "";

        if (lastCommandPhrase) {
            transcriptNote = `Matched command: ${lastCommandPhrase}`;
            transcriptNoteClass = "mvc-transcript-note--success";
        } else if (this.lastHeard) {
            transcriptNote = "No matching command found.";
            transcriptNoteClass = "mvc-transcript-note--warning";
        }

        const root = document.createElement("div");
        root.className = `mvc-root mvc-root--${this._getDisplayMode()}`;

        const panel = document.createElement("section");
        panel.className = [
            "mvc-panel",
            "glass",
            "glass-readable",
            "glass-stack",
            `mvc-panel--health-${this.health}`,
            `mvc-panel--stage-${this.stage}`,
            this.feedback ? `mvc-panel--feedback-${this.feedback}` : ""
        ].filter(Boolean).join(" ");
        panel.style.setProperty("--mvc-command-window-ms", `${this.commandWindowMs}ms`);

        const hero = document.createElement("header");
        hero.className = "mvc-hero glass-stack";

        const statusLine = document.createElement("div");
        statusLine.className = "mvc-status-line";

        const dot = document.createElement("span");
        dot.className = "mvc-dot";

        const statusPill = document.createElement("div");
        statusPill.className = "mvc-status-pill";

        const statusPillCopy = document.createElement("span");
        statusPillCopy.className = "mvc-status-pill-copy";
        statusPillCopy.textContent = copy.eyebrow;

        statusPill.appendChild(dot);
        statusPill.appendChild(statusPillCopy);

        const badge = document.createElement("div");
        badge.className = "mvc-badge";
        badge.textContent = this._getStatusBadge();

        statusLine.appendChild(statusPill);
        statusLine.appendChild(badge);
        hero.appendChild(statusLine);

        const heroGrid = document.createElement("div");
        heroGrid.className = "mvc-hero-grid";

        const heroCopy = document.createElement("div");
        heroCopy.className = "mvc-hero-copy glass-stack";

        const eyebrow = document.createElement("span");
        eyebrow.className = "mvc-eyebrow";
        eyebrow.textContent = copy.eyebrow;

        const title = document.createElement("h2");
        title.className = "mvc-title";
        title.textContent = copy.title;

        const detail = document.createElement("p");
        detail.className = "mvc-detail";
        detail.textContent = copy.detail;

        heroCopy.appendChild(eyebrow);
        heroCopy.appendChild(title);
        heroCopy.appendChild(detail);

        const orbit = document.createElement("div");
        orbit.className = "mvc-orbit glass";

        const orbitRing = document.createElement("div");
        orbitRing.className = "mvc-orbit-ring";

        const orbitLabel = document.createElement("span");
        orbitLabel.className = "mvc-orbit-label";
        orbitLabel.textContent = orbitCopy.label;

        const orbitValue = document.createElement("span");
        orbitValue.className = "mvc-orbit-value";
        orbitValue.textContent = orbitCopy.value;

        const orbitDetail = document.createElement("span");
        orbitDetail.className = "mvc-orbit-detail";
        orbitDetail.textContent = orbitCopy.detail;

        orbitRing.appendChild(orbitLabel);
        orbitRing.appendChild(orbitValue);
        orbitRing.appendChild(this._createWaveBars());
        orbitRing.appendChild(orbitDetail);
        orbit.appendChild(orbitRing);

        heroGrid.appendChild(heroCopy);
        heroGrid.appendChild(orbit);
        hero.appendChild(heroGrid);
        panel.appendChild(hero);

        const metrics = document.createElement("div");
        metrics.className = "mvc-metrics";
        metrics.appendChild(this._createMetricCard("Response window", this._formatDuration(this.commandWindowMs), "window"));
        metrics.appendChild(this._createMetricCard("Commands", commandCountCopy, "commands"));
        metrics.appendChild(this._createMetricCard("Last action", lastCommandPhrase || "Awaiting first command", "action"));
        panel.appendChild(metrics);

        if (this.stage === "command" && this.health === "listening") {
            const liveWindow = document.createElement("section");
            liveWindow.className = "mvc-listen-band glass";

            const liveHeading = document.createElement("div");
            liveHeading.className = "mvc-section-heading";

            const liveLabel = document.createElement("span");
            liveLabel.className = "mvc-section-label";
            liveLabel.textContent = "Live command window";

            const liveNote = document.createElement("span");
            liveNote.className = "mvc-section-note";
            liveNote.textContent = `${this._formatDuration(this.commandWindowMs)} to speak a command`;

            liveHeading.appendChild(liveLabel);
            liveHeading.appendChild(liveNote);

            const progress = document.createElement("div");
            progress.className = "mvc-progress";

            const progressBar = document.createElement("div");
            progressBar.className = "mvc-progress-bar";

            progress.appendChild(progressBar);
            liveWindow.appendChild(liveHeading);
            liveWindow.appendChild(progress);
            panel.appendChild(liveWindow);
        }

        const transcript = document.createElement("section");
        transcript.className = "mvc-transcript glass glass-readable";
        transcript.setAttribute("aria-live", "polite");

        const transcriptHeading = document.createElement("div");
        transcriptHeading.className = "mvc-section-heading";

        const transcriptLabel = document.createElement("span");
        transcriptLabel.className = "mvc-section-label";
        transcriptLabel.textContent = "Last heard";

        const transcriptState = document.createElement("span");
        transcriptState.className = "mvc-section-note";
        transcriptState.textContent = this._getStatusBadge();

        transcriptHeading.appendChild(transcriptLabel);
        transcriptHeading.appendChild(transcriptState);

        const transcriptBody = document.createElement("p");
        transcriptBody.className = "mvc-transcript-text";
        transcriptBody.textContent = transcriptText;

        const transcriptMeta = document.createElement("div");
        transcriptMeta.className = ["mvc-transcript-note", transcriptNoteClass].filter(Boolean).join(" ");
        transcriptMeta.textContent = transcriptNote;

        transcript.appendChild(transcriptHeading);
        transcript.appendChild(transcriptBody);
        transcript.appendChild(transcriptMeta);
        panel.appendChild(transcript);

        if (hints.length && this.health !== "error") {
            const hintPanel = document.createElement("section");
            hintPanel.className = "mvc-command-panel glass";

            const hintHeading = document.createElement("div");
            hintHeading.className = "mvc-section-heading";

            const hintLabel = document.createElement("span");
            hintLabel.className = "mvc-section-label";
            hintLabel.textContent = "Suggested commands";

            const hintNote = document.createElement("span");
            hintNote.className = "mvc-section-note";
            hintNote.textContent = commandCountCopy;

            const hintRow = document.createElement("div");
            hintRow.className = "mvc-hints";

            hints.forEach((hint) => {
                const chip = document.createElement("span");
                chip.className = "mvc-hint";
                chip.textContent = hint;
                hintRow.appendChild(chip);
            });

            hintHeading.appendChild(hintLabel);
            hintHeading.appendChild(hintNote);
            hintPanel.appendChild(hintHeading);
            hintPanel.appendChild(hintRow);
            panel.appendChild(hintPanel);
        }

        if (this.error && (this.error.detail || this.error.message)) {
            const diagnostic = document.createElement("section");
            diagnostic.className = "mvc-diagnostic glass";

            const diagnosticLabel = document.createElement("span");
            diagnosticLabel.className = "mvc-section-label";
            diagnosticLabel.textContent = "Diagnostic";

            const diagnosticCopy = document.createElement("p");
            diagnosticCopy.className = "mvc-diagnostic-copy";
            diagnosticCopy.textContent = this.error.detail || this.error.message;

            diagnostic.appendChild(diagnosticLabel);
            diagnostic.appendChild(diagnosticCopy);
            panel.appendChild(diagnostic);
        }

        root.appendChild(panel);
        return root;
    }
});
