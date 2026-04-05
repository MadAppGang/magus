import { readSettings, writeSettings, readGlobalSettings, writeGlobalSettings, } from "./claude-settings.js";
/** Read the current value of a setting from the given scope */
export async function readSettingValue(setting, scope, projectPath) {
    const settings = scope === "user"
        ? await readGlobalSettings()
        : await readSettings(projectPath);
    if (setting.storage.type === "attribution") {
        // Attribution is an object: { commit: "", pr: "" } means disabled
        const attr = settings.attribution;
        if (attr && attr.commit === "" && attr.pr === "") {
            return "false";
        }
        return undefined; // default (enabled)
    }
    else if (setting.storage.type === "attribution-text") {
        // Custom attribution text: read from attribution.commit, strip the Co-Authored-By trailer prefix
        const attr = settings.attribution;
        if (!attr || (attr.commit === "" && attr.pr === "")) {
            // Attribution is disabled or not set — no custom text stored
            return undefined;
        }
        const commit = attr.commit;
        if (!commit) {
            return undefined;
        }
        // The commit value is "Co-Authored-By: Magus <magus@madappgang.com>\n\n{customText}"
        // Strip the trailer prefix if present
        const trailerPrefix = "Co-Authored-By: Magus <magus@madappgang.com>\n\n";
        if (commit.startsWith(trailerPrefix)) {
            const text = commit.slice(trailerPrefix.length);
            return text.length > 0 ? text : undefined;
        }
        // If no trailer prefix, the value is the raw text (or Claude default — return undefined)
        return undefined;
    }
    else if (setting.storage.type === "env") {
        const env = settings.env;
        return env?.[setting.storage.key];
    }
    else {
        // Direct settings key (supports dot notation like "permissions.defaultMode")
        const keys = setting.storage.key.split(".");
        let value = settings;
        for (const k of keys) {
            value = value?.[k];
        }
        return value !== undefined && value !== null ? String(value) : undefined;
    }
}
/** Write a setting value to the given scope */
export async function writeSettingValue(setting, value, scope, projectPath) {
    const settings = scope === "user"
        ? await readGlobalSettings()
        : await readSettings(projectPath);
    if (setting.storage.type === "attribution") {
        // Boolean toggle: "false" -> write { commit: "", pr: "" }, "true"/undefined -> delete key
        if (value === "false") {
            settings.attribution = { commit: "", pr: "" };
        }
        else {
            delete settings.attribution;
        }
    }
    else if (setting.storage.type === "attribution-text") {
        const attr = settings.attribution;
        // If attribution is explicitly disabled ({ commit: "", pr: "" }), do not overwrite it
        if (attr && attr.commit === "" && attr.pr === "") {
            return;
        }
        if (value && value.trim().length > 0) {
            // Write custom text: commit gets a Co-Authored-By trailer + the text; pr gets the text
            settings.attribution = {
                commit: `Co-Authored-By: Magus <magus@madappgang.com>\n\n${value}`,
                pr: value,
            };
        }
        else {
            // Empty value: remove attribution key entirely (revert to Claude defaults)
            delete settings.attribution;
        }
    }
    else if (setting.storage.type === "env") {
        // Write to the "env" block in settings.json
        settings.env = settings.env || {};
        if (value === undefined || value === "" || value === setting.defaultValue) {
            delete settings.env[setting.storage.key];
            // Clean up empty env block
            if (Object.keys(settings.env).length === 0) {
                delete settings.env;
            }
        }
        else {
            settings.env[setting.storage.key] = value;
        }
    }
    else {
        // Direct settings key (supports dot notation)
        const keys = setting.storage.key.split(".");
        if (keys.length === 1) {
            if (value === undefined || value === "") {
                delete settings[keys[0]];
            }
            else {
                // Try to preserve type: boolean, number, or string
                settings[keys[0]] = parseSettingValue(value, setting.type);
            }
        }
        else {
            // Nested key like "permissions.defaultMode"
            let obj = settings;
            for (let i = 0; i < keys.length - 1; i++) {
                obj[keys[i]] = obj[keys[i]] || {};
                obj = obj[keys[i]];
            }
            const lastKey = keys[keys.length - 1];
            if (value === undefined || value === "") {
                delete obj[lastKey];
            }
            else {
                obj[lastKey] = parseSettingValue(value, setting.type);
            }
        }
    }
    if (scope === "user") {
        await writeGlobalSettings(settings);
    }
    else {
        await writeSettings(settings, projectPath);
    }
}
function parseSettingValue(value, type) {
    if (type === "boolean") {
        return value === "true" || value === "1";
    }
    // Try number
    const num = Number(value);
    if (!Number.isNaN(num) && value.trim() !== "") {
        return value; // Keep as string for env vars
    }
    return value;
}
/** Read all setting values for the catalog */
export async function readAllSettings(catalog, scope, projectPath) {
    const values = new Map();
    for (const setting of catalog) {
        values.set(setting.id, await readSettingValue(setting, scope, projectPath));
    }
    return values;
}
/** Read all setting values from both scopes simultaneously */
export async function readAllSettingsBothScopes(catalog, projectPath) {
    const result = new Map();
    const [userValues, projectValues] = await Promise.all([
        readAllSettings(catalog, "user", projectPath),
        readAllSettings(catalog, "project", projectPath),
    ]);
    for (const setting of catalog) {
        result.set(setting.id, {
            user: userValues.get(setting.id),
            project: projectValues.get(setting.id),
        });
    }
    return result;
}
