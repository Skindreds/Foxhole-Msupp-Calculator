import { getCookie, setCookie, generateId } from './utils.js';

const STORAGE_KEY = 'msupp_profiles_v1';
const COOKIE_NAME = 'msupp_profiles_v1';
const COOKIE_DAYS = 365;

// Data shape
// state = { selectedProfileId: string, profiles: [{ id, name, image?: string, rows: Row[], config: { desiredHours?: number } }] }
// Row = { id, name, consumptionPerHour, inventoryAtUpdate, updatedAtMs }

function getDefaultState() {
    const defaultProfileId = generateId('profile');
    return {
        selectedProfileId: defaultProfileId,
        profiles: [
            { id: defaultProfileId, name: 'Local Padrão', rows: [], config: {} }
        ]
    };
}

export function loadState() {
    try {
        // Try localStorage first (better for large data like images)
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            // Fallback to cookies for backward compatibility
            raw = getCookie(COOKIE_NAME);
        }
        if (!raw) return getDefaultState();
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.profiles)) return getDefaultState();
        return parsed;
    } catch (_) {
        return getDefaultState();
    }
}

export function saveState(state) {
    try {
        const raw = JSON.stringify(state);
        // Save to localStorage (primary storage for large data)
        localStorage.setItem(STORAGE_KEY, raw);

        // Also try to save to cookies (fallback, may fail if too large)
        try {
            setCookie(COOKIE_NAME, raw, COOKIE_DAYS);
        } catch (_) {
            // Cookie too large, ignore - localStorage is primary
        }
    } catch (_) {
        // ignore
    }
}

export function getSelectedProfile(state) {
    return state.profiles.find(p => p.id === state.selectedProfileId) || state.profiles[0];
}

export function setSelectedProfile(state, profileId) {
    state.selectedProfileId = profileId;
    saveState(state);
}

export function createProfile(state, name) {
    const id = generateId('profile');
    const profile = { id, name: name || 'Novo Local', rows: [], config: {} };
    state.profiles.push(profile);
    state.selectedProfileId = id;
    saveState(state);
    return profile;
}

export function deleteProfile(state, profileId) {
    const idx = state.profiles.findIndex(p => p.id === profileId);
    if (idx >= 0) {
        state.profiles.splice(idx, 1);
        if (!state.profiles.length) {
            const def = getDefaultState();
            state.profiles = def.profiles;
            state.selectedProfileId = def.selectedProfileId;
        } else if (!state.profiles.find(p => p.id === state.selectedProfileId)) {
            state.selectedProfileId = state.profiles[0].id;
        }
        saveState(state);
    }
}

export function upsertRow(profile, row) {
    const idx = profile.rows.findIndex(r => r.id === row.id);
    if (idx >= 0) profile.rows[idx] = row; else profile.rows.push(row);
}

export function deleteRow(profile, rowId) {
    const idx = profile.rows.findIndex(r => r.id === rowId);
    if (idx >= 0) profile.rows.splice(idx, 1);
}

export function setDesiredHours(profile, hours) {
    profile.config.desiredHours = hours;
}

export function setProfileImage(profile, imageBase64) {
    profile.image = imageBase64;
}

export function migrateFromCookies() {
    // Migrate old cookie data to localStorage if needed
    try {
        const cookieData = getCookie(COOKIE_NAME);
        const localData = localStorage.getItem(STORAGE_KEY);

        if (cookieData && !localData) {
            // Migrate from cookies to localStorage
            localStorage.setItem(STORAGE_KEY, cookieData);
        }
    } catch (_) {
        // ignore migration errors
    }
}

// Export/Import with short URLs using localStorage
const EXPORT_PREFIX = 'msupp_export_';

export function createExportId(data) {
    const exportId = generateId('export');
    const exportKey = EXPORT_PREFIX + exportId;
    try {
        localStorage.setItem(exportKey, JSON.stringify(data));
        return exportId;
    } catch (_) {
        return null;
    }
}

export function getExportData(exportId) {
    const exportKey = EXPORT_PREFIX + exportId;
    try {
        const raw = localStorage.getItem(exportKey);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

export function cleanOldExports() {
    // Clean exports older than 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    try {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(EXPORT_PREFIX)) {
                const exportId = key.replace(EXPORT_PREFIX, '');
                // Extract timestamp from ID (format: export_timestamp_random)
                const parts = exportId.split('_');
                if (parts.length >= 2) {
                    const timestamp = parseInt(parts[1]);
                    if (timestamp < thirtyDaysAgo) {
                        localStorage.removeItem(key);
                    }
                }
            }
        });
    } catch (_) {
        // ignore cleanup errors
    }
}


