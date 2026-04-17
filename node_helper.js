const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const NodeHelper = require("node_helper");
const VoiceCommands = require("./voice_commands");

const DEFAULT_CONFIG = {
    modelDir: "models/vosk-model-small-en-us-0.15",
    wakeWord: "mirror",
    commandWindowMs: 4000,
    device: "default",
    pythonPath: "",
    micCommand: "arecord",
    restartDelayMs: 1500,
    enabledCommands: []
};

module.exports = NodeHelper.create({
    start() {
        this.proc = null;
        this.procToken = 0;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.restartTimer = null;
        this.pendingRestart = false;
        this.shouldBeRunning = false;
        this.isStopping = false;

        this.cfg = { ...DEFAULT_CONFIG };
        this.state = {
            health: "ready",
            stage: "idle",
            listening: false,
            commandWindowMs: DEFAULT_CONFIG.commandWindowMs,
            error: null
        };
        this.lastStateSignature = "";
    },

    socketNotificationReceived(notification, payload) {
        if (notification === "MVC_START") {
            this.cfg = this._normalizeConfig(payload);
            this.shouldBeRunning = true;

            if (this.proc || this.restartTimer) {
                this._restart("Configuration updated.");
            } else {
                this._startProcess(false);
            }
            return;
        }

        if (notification === "MVC_STOP") {
            this.shouldBeRunning = false;
            this.pendingRestart = false;
            this._clearRestartTimer();
            this._stopProcess();
        }
    },

    _normalizeConfig(payload) {
        const merged = { ...DEFAULT_CONFIG, ...(payload || {}) };

        return {
            ...merged,
            wakeWord: String(merged.wakeWord || DEFAULT_CONFIG.wakeWord).trim() || DEFAULT_CONFIG.wakeWord,
            device: String(merged.device || DEFAULT_CONFIG.device).trim() || DEFAULT_CONFIG.device,
            pythonPath: String(merged.pythonPath || "").trim(),
            micCommand: String(merged.micCommand || DEFAULT_CONFIG.micCommand).trim() || DEFAULT_CONFIG.micCommand,
            commandWindowMs: Math.max(1000, Number(merged.commandWindowMs) || DEFAULT_CONFIG.commandWindowMs),
            restartDelayMs: Math.max(500, Number(merged.restartDelayMs) || DEFAULT_CONFIG.restartDelayMs),
            enabledCommands: Array.isArray(merged.enabledCommands)
                ? merged.enabledCommands
                : Array.isArray(merged.commands)
                    ? merged.commands
                    : []
        };
    },

    _startProcess(isRestart) {
        this._clearRestartTimer();

        const startupHealth = isRestart ? "restarting" : "starting";
        this._emitState({
            health: startupHealth,
            stage: "idle",
            listening: false,
            commandWindowMs: this.cfg.commandWindowMs,
            error: null
        });

        const validation = this._validateRuntime();
        if (!validation.ok) {
            this._emitState({
                health: "error",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: validation.error
            });
            return;
        }

        const runtime = validation.runtime;
        const args = [
            runtime.scriptPath,
            "--model", runtime.modelPath,
            "--wake", this.cfg.wakeWord,
            "--commands_json", JSON.stringify(runtime.grammar),
            "--window_ms", String(this.cfg.commandWindowMs),
            "--device", this.cfg.device,
            "--mic_command", this.cfg.micCommand
        ];

        const token = ++this.procToken;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.isStopping = false;

        try {
            this.proc = spawn(runtime.pythonPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
            this.proc = null;
            this._emitState({
                health: "error",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: {
                    code: "PYTHON_SPAWN_FAILED",
                    message: "Unable to start the voice worker.",
                    detail: error.message
                }
            });
            return;
        }

        this._emitState({
            health: "ready",
            stage: "idle",
            listening: false,
            commandWindowMs: this.cfg.commandWindowMs,
            error: null
        });

        this.proc.stdout.setEncoding("utf8");
        this.proc.stderr.setEncoding("utf8");

        this.proc.stdout.on("data", (chunk) => this._handleStdoutChunk(chunk, token));
        this.proc.stderr.on("data", (chunk) => this._handleStderrChunk(chunk, token));

        this.proc.on("error", (error) => {
            if (token !== this.procToken) {
                return;
            }

            this._emitState({
                health: "error",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: {
                    code: "PYTHON_PROCESS_ERROR",
                    message: "The voice worker failed to start.",
                    detail: error.message
                }
            });
        });

        this.proc.on("close", (code, signal) => this._handleProcessClose(code, signal, token));
    },

    _validateRuntime() {
        const scriptPath = path.join(__dirname, "stt_vosk.py");
        if (!fs.existsSync(scriptPath)) {
            return {
                ok: false,
                error: {
                    code: "SCRIPT_MISSING",
                    message: "The speech worker script is missing.",
                    detail: scriptPath
                }
            };
        }

        const modelPath = path.isAbsolute(this.cfg.modelDir)
            ? this.cfg.modelDir
            : path.join(__dirname, this.cfg.modelDir);

        if (!fs.existsSync(modelPath)) {
            return {
                ok: false,
                error: {
                    code: "MODEL_NOT_FOUND",
                    message: "The Vosk model path could not be found.",
                    detail: modelPath
                }
            };
        }

        const grammar = VoiceCommands.getRecognizerGrammar(this.cfg);
        if (!grammar.length) {
            return {
                ok: false,
                error: {
                    code: "NO_COMMANDS_ENABLED",
                    message: "No voice commands are enabled.",
                    detail: "Check enabledCommands in the module config."
                }
            };
        }

        const pythonPath = this._resolvePythonPath();
        if (!pythonPath) {
            return {
                ok: false,
                error: {
                    code: "PYTHON_NOT_FOUND",
                    message: "Python 3 is not available for the voice worker.",
                    detail: "Set pythonPath or create a local .venv for this module."
                }
            };
        }

        if (!this._validatePythonDependency(pythonPath)) {
            return {
                ok: false,
                error: {
                    code: "PYTHON_VOSK_MISSING",
                    message: "The Python vosk package is not installed.",
                    detail: `Run "${pythonPath} -m pip install -r requirements.txt".`
                }
            };
        }

        if (!this._commandExists(this.cfg.micCommand, ["--version"])) {
            return {
                ok: false,
                error: {
                    code: "MIC_COMMAND_NOT_FOUND",
                    message: "The microphone capture command is unavailable.",
                    detail: `Unable to execute "${this.cfg.micCommand} --version".`
                }
            };
        }

        return {
            ok: true,
            runtime: {
                pythonPath,
                modelPath,
                scriptPath,
                grammar
            }
        };
    },

    _resolvePythonPath() {
        const localUnix = path.join(__dirname, ".venv", "bin", "python3");
        const localWindows = path.join(__dirname, ".venv", "Scripts", "python.exe");
        const candidates = Array.from(new Set([
            this.cfg.pythonPath,
            localUnix,
            localWindows,
            "python3",
            "python"
        ].filter(Boolean)));

        for (const candidate of candidates) {
            if (this._commandExists(candidate, ["--version"])) {
                return candidate;
            }
        }

        return "";
    },

    _validatePythonDependency(pythonPath) {
        const result = spawnSync(pythonPath, ["-c", "import vosk"], { stdio: "ignore" });
        return !result.error && result.status === 0;
    },

    _commandExists(command, args) {
        const isPath = command.includes(path.sep) || path.isAbsolute(command);
        if (isPath && !fs.existsSync(command)) {
            return false;
        }

        const result = spawnSync(command, args, { stdio: "ignore" });
        return !result.error && result.status === 0;
    },

    _handleStdoutChunk(chunk, token) {
        if (token !== this.procToken) {
            return;
        }

        this.stdoutBuffer += String(chunk || "");
        this._flushBufferedLines("stdout");
    },

    _handleStderrChunk(chunk, token) {
        if (token !== this.procToken) {
            return;
        }

        this.stderrBuffer += String(chunk || "");
        this._flushBufferedLines("stderr");
    },

    _flushBufferedLines(streamName) {
        const bufferKey = streamName === "stderr" ? "stderrBuffer" : "stdoutBuffer";
        const buffer = this[bufferKey];
        const lines = buffer.split(/\r?\n/);
        this[bufferKey] = lines.pop() || "";

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }

            if (streamName === "stderr") {
                console.error(`[MMM-VoiceControl] ${line}`);
                continue;
            }

            let msg = null;
            try {
                msg = JSON.parse(line);
            } catch (_) {
                console.warn(`[MMM-VoiceControl] Ignoring malformed worker output: ${line}`);
                continue;
            }

            this._handleWorkerMessage(msg);
        }
    },

    _handleWorkerMessage(msg) {
        if (msg.type === "ready") {
            this._emitState({
                health: "ready",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: null
            });
            return;
        }

        if (msg.type === "status") {
            const nextStage = msg.state === "listening_cmd" ? "command" : "wake";
            this._emitState({
                health: "listening",
                stage: nextStage,
                listening: true,
                commandWindowMs: this.cfg.commandWindowMs,
                error: null
            });
            return;
        }

        if (msg.type === "command") {
            const text = VoiceCommands.normalizeCommandText(msg.text);
            const command = VoiceCommands.findCommandByText(text, this.cfg);

            this.sendSocketNotification("MVC_COMMAND", {
                text,
                recognized: !!command,
                commandId: command ? command.id : "",
                intent: command ? command.intent : "",
                payload: command ? command.payload : null
            });
            return;
        }

        if (msg.type === "error") {
            this._emitState({
                health: "error",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: {
                    code: msg.code || "WORKER_ERROR",
                    message: msg.message || "The voice worker reported an error.",
                    detail: msg.detail || ""
                }
            });
        }
    },

    _handleProcessClose(code, signal, token) {
        if (token !== this.procToken) {
            return;
        }

        this._flushTrailingBuffer("stdout");
        this._flushTrailingBuffer("stderr");

        this.proc = null;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";

        if (this.pendingRestart) {
            this.pendingRestart = false;
            this._startProcess(true);
            return;
        }

        if (this.isStopping || !this.shouldBeRunning) {
            this.isStopping = false;
            this._emitState({
                health: "ready",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: null
            });
            return;
        }

        const error = this.state.error || {
            code: "WORKER_EXITED",
            message: "The voice worker stopped unexpectedly.",
            detail: `Exit code: ${code === null ? "unknown" : code}, signal: ${signal || "none"}.`
        };

        this._emitState({
            health: "restarting",
            stage: "idle",
            listening: false,
            commandWindowMs: this.cfg.commandWindowMs,
            error
        });

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.shouldBeRunning) {
                this._startProcess(true);
            }
        }, this.cfg.restartDelayMs);
    },

    _flushTrailingBuffer(streamName) {
        const bufferKey = streamName === "stderr" ? "stderrBuffer" : "stdoutBuffer";
        const remaining = this[bufferKey].trim();
        if (!remaining) {
            return;
        }

        this[bufferKey] = "";

        if (streamName === "stderr") {
            console.error(`[MMM-VoiceControl] ${remaining}`);
            return;
        }

        try {
            this._handleWorkerMessage(JSON.parse(remaining));
        } catch (_) {
            console.warn(`[MMM-VoiceControl] Ignoring trailing worker output: ${remaining}`);
        }
    },

    _restart(message) {
        this.pendingRestart = true;
        this._clearRestartTimer();
        this._emitState({
            health: "restarting",
            stage: "idle",
            listening: false,
            commandWindowMs: this.cfg.commandWindowMs,
            error: message
                ? { code: "RESTARTING", message, detail: "" }
                : null
        });

        if (this.proc) {
            this._stopProcess();
        } else {
            this.pendingRestart = false;
            this._startProcess(true);
        }
    },

    _stopProcess() {
        if (!this.proc) {
            this._emitState({
                health: "ready",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: null
            });
            return;
        }

        this.isStopping = true;

        try {
            this.proc.kill("SIGTERM");
        } catch (_) {
            this.proc = null;
            this.isStopping = false;
            this._emitState({
                health: "ready",
                stage: "idle",
                listening: false,
                commandWindowMs: this.cfg.commandWindowMs,
                error: null
            });
        }
    },

    _clearRestartTimer() {
        if (!this.restartTimer) {
            return;
        }

        clearTimeout(this.restartTimer);
        this.restartTimer = null;
    },

    _emitState(nextState) {
        const state = {
            health: nextState.health || "ready",
            stage: nextState.stage || "idle",
            listening: Boolean(nextState.listening),
            commandWindowMs: nextState.commandWindowMs || this.cfg.commandWindowMs,
            error: nextState.error
                ? {
                    code: nextState.error.code || "VOICE_ERROR",
                    message: nextState.error.message || "Voice control error",
                    detail: nextState.error.detail || ""
                }
                : null
        };
        const signature = JSON.stringify(state);

        if (signature === this.lastStateSignature) {
            return;
        }

        this.state = state;
        this.lastStateSignature = signature;
        this.sendSocketNotification("MVC_STATE", state);
    }
});
