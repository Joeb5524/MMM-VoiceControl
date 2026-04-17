(function attachVoiceCommands(root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.MVCVoiceCommands = api;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function createVoiceCommandApi() {
    const registry = [
        {
            id: "next-screen",
            phrase: "next screen",
            aliases: ["next"],
            intent: "NEXT_SCREEN",
            payload: {},
            notifications: [{ notification: "ASSIST_TOUCH_NEXT_SCREEN", payload: {} }],
            hintOrder: 10
        },
        {
            id: "home-screen",
            phrase: "home screen",
            aliases: ["home"],
            intent: "SET_SCREEN",
            payload: { screen: "home" },
            notifications: [{ notification: "ASSIST_SCREEN_SET", payload: { screen: "home" } }],
            hintOrder: 20
        },
        {
            id: "meds-screen",
            phrase: "meds screen",
            aliases: ["medication screen"],
            intent: "SET_SCREEN",
            payload: { screen: "meds" },
            notifications: [{ notification: "ASSIST_SCREEN_SET", payload: { screen: "meds" } }],
            hintOrder: 30
        },
        {
            id: "care-screen",
            phrase: "care screen",
            aliases: [],
            intent: "SET_SCREEN",
            payload: { screen: "care" },
            notifications: [{ notification: "ASSIST_SCREEN_SET", payload: { screen: "care" } }]
        },
        {
            id: "joe-screen",
            phrase: "joe screen",
            aliases: [],
            intent: "SET_SCREEN",
            payload: { screen: "joe" },
            notifications: [{ notification: "ASSIST_SCREEN_SET", payload: { screen: "joe" } }]
        },
        {
            id: "call-carer",
            phrase: "call carer",
            aliases: ["call caregiver"],
            intent: "CALL_CARER",
            payload: { reason: "voice" },
            notifications: [{ notification: "AUDIOCALL_START_REQUEST", payload: { reason: "voice" } }],
            hintOrder: 40
        },
        {
            id: "answer-call",
            phrase: "answer call",
            aliases: ["accept call"],
            intent: "CALL_ACCEPT",
            payload: {},
            notifications: [{ notification: "AUDIOCALL_ACCEPT_REQUEST", payload: {} }]
        },
        {
            id: "decline-call",
            phrase: "decline call",
            aliases: ["reject call"],
            intent: "CALL_DECLINE",
            payload: {},
            notifications: [{ notification: "AUDIOCALL_DECLINE_REQUEST", payload: {} }]
        },
        {
            id: "hang-up",
            phrase: "hang up",
            aliases: ["end call"],
            intent: "CALL_HANGUP",
            payload: {},
            notifications: [{ notification: "AUDIOCALL_END_REQUEST", payload: {} }]
        },
        {
            id: "send-help",
            phrase: "send help",
            aliases: ["need help"],
            intent: "SEND_HELP",
            payload: { title: "Mirror alert", message: "Assistance requested (voice).", level: "help" },
            notifications: [{
                notification: "SR_CARE_ALERT",
                payload: { title: "Mirror alert", message: "Assistance requested (voice).", level: "help" }
            }],
            hintOrder: 50
        },
        {
            id: "acknowledge-alert",
            phrase: "acknowledge alert",
            aliases: ["acknowledge"],
            intent: "ACK_ALERT",
            payload: {},
            notifications: [{ notification: "SR_ACK_ACTIVE_REQUEST", payload: {} }]
        },
        {
            id: "dismiss-alert",
            phrase: "dismiss alert",
            aliases: [],
            intent: "DISMISS_ALERT",
            payload: {},
            notifications: [{ notification: "SR_DISMISS_ACTIVE_REQUEST", payload: {} }]
        },
        {
            id: "medication-taken",
            phrase: "medication taken",
            aliases: ["medicine taken"],
            intent: "MED_TAKEN",
            payload: {},
            notifications: [{ notification: "MED_MARK_NEXT_DUE_TAKEN", payload: {} }]
        },
        {
            id: "play-calm-music",
            phrase: "play calm music",
            aliases: [],
            intent: "MUSIC_PLAY_QUERY",
            payload: { query: "calm" },
            notifications: [{ notification: "MUSIC_PLAY_QUERY", payload: { query: "calm" } }]
        },
        {
            id: "play-sleep-music",
            phrase: "play sleep music",
            aliases: [],
            intent: "MUSIC_PLAY_QUERY",
            payload: { query: "sleep" },
            notifications: [{ notification: "MUSIC_PLAY_QUERY", payload: { query: "sleep" } }]
        },
        {
            id: "play-morning-music",
            phrase: "play morning music",
            aliases: [],
            intent: "MUSIC_PLAY_QUERY",
            payload: { query: "morning" },
            notifications: [{ notification: "MUSIC_PLAY_QUERY", payload: { query: "morning" } }]
        },
        {
            id: "play-exercise-music",
            phrase: "play exercise music",
            aliases: [],
            intent: "MUSIC_PLAY_QUERY",
            payload: { query: "exercise" },
            notifications: [{ notification: "MUSIC_PLAY_QUERY", payload: { query: "exercise" } }]
        },
        {
            id: "play-music",
            phrase: "play music",
            aliases: [],
            intent: "MUSIC_PLAY_QUERY",
            payload: { query: "music" },
            notifications: [{ notification: "MUSIC_PLAY_QUERY", payload: { query: "music" } }],
            hintOrder: 60
        },
        {
            id: "stop-music",
            phrase: "stop music",
            aliases: ["pause music"],
            intent: "MUSIC_STOP",
            payload: {},
            notifications: [{ notification: "MUSIC_STOP", payload: {} }]
        },
        {
            id: "lights-on",
            phrase: "lights on",
            aliases: ["turn lights on"],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "on", target: "all" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "on", target: "all" } }],
            hintOrder: 70
        },
        {
            id: "lights-off",
            phrase: "lights off",
            aliases: ["turn lights off"],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "off", target: "all" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "off", target: "all" } }]
        },
        {
            id: "toggle-lights",
            phrase: "toggle lights",
            aliases: [],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "toggle", target: "all" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "toggle", target: "all" } }]
        },
        {
            id: "set-lights-red",
            phrase: "set lights red",
            aliases: [],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "color", target: "all", rgb: "#ff0000" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "color", target: "all", rgb: "#ff0000" } }]
        },
        {
            id: "set-lights-green",
            phrase: "set lights green",
            aliases: [],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "color", target: "all", rgb: "#00ff00" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "color", target: "all", rgb: "#00ff00" } }]
        },
        {
            id: "set-lights-blue",
            phrase: "set lights blue",
            aliases: [],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "color", target: "all", rgb: "#0000ff" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "color", target: "all", rgb: "#0000ff" } }]
        },
        {
            id: "set-lights-white",
            phrase: "set lights white",
            aliases: [],
            intent: "HUE_COMMAND",
            payload: { hue: { action: "color", target: "all", rgb: "#ffffff" } },
            notifications: [{ notification: "HUE_COMMAND", payload: { action: "color", target: "all", rgb: "#ffffff" } }]
        }
    ];

    function cloneValue(value) {
        if (value === null || typeof value === "undefined") {
            return value;
        }

        return JSON.parse(JSON.stringify(value));
    }

    function normalizeCommandText(text) {
        return String(text || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function getCommandPhrases(command) {
        return [command.phrase]
            .concat(Array.isArray(command.aliases) ? command.aliases : [])
            .map((phrase) => normalizeCommandText(phrase))
            .filter(Boolean);
    }

    function matchesFilter(command, filters) {
        if (!filters.length) {
            return true;
        }

        const values = [command.id, command.intent]
            .concat(getCommandPhrases(command))
            .map((value) => normalizeCommandText(value));

        return filters.some((filter) => values.includes(filter));
    }

    function getRequestedCommands(options) {
        const requested = []
            .concat(options && Array.isArray(options.enabledCommands) ? options.enabledCommands : [])
            .concat(options && Array.isArray(options.commands) ? options.commands : [])
            .map((value) => normalizeCommandText(value))
            .filter(Boolean);

        return Array.from(new Set(requested));
    }

    function getActiveCommands(options) {
        const requested = getRequestedCommands(options);
        const filtered = registry.filter((command) => matchesFilter(command, requested));

        return filtered.map((command) => cloneValue(command));
    }

    function getRecognizerGrammar(options) {
        const grammar = getActiveCommands(options).flatMap((command) => getCommandPhrases(command));
        return Array.from(new Set(grammar));
    }

    function getHintCommands(options, maxCount) {
        const limit = Number.isFinite(maxCount) && maxCount > 0 ? Math.floor(maxCount) : 3;

        return getActiveCommands(options)
            .filter((command) => command.hintOrder)
            .sort((left, right) => left.hintOrder - right.hintOrder)
            .slice(0, limit);
    }

    function getHintPhrases(options, maxCount) {
        return getHintCommands(options, maxCount).map((command) => command.phrase);
    }

    function findCommandById(commandId, options) {
        const normalizedId = normalizeCommandText(commandId);
        return getActiveCommands(options).find((command) => command.id === normalizedId) || null;
    }

    function findCommandByText(text, options) {
        const normalized = normalizeCommandText(text);

        return getActiveCommands(options).find((command) => {
            return getCommandPhrases(command).includes(normalized);
        }) || null;
    }

    return {
        registry: registry.map((command) => cloneValue(command)),
        normalizeCommandText,
        getActiveCommands,
        getRecognizerGrammar,
        getHintCommands,
        getHintPhrases,
        findCommandById,
        findCommandByText
    };
}));
