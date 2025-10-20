import { getCookie, setCookie, generateId } from './utils.js';

const COOKIE_NAME = 'msupp_profiles_v1';
const COOKIE_DAYS = 365;

// Data shape
// state = { selectedProfileId: string, profiles: [{ id, name, rows: Row[], config: { desiredHours?: number } }] }
// Row = { id, name, consumptionPerHour, inventoryAtUpdate, updatedAtMs }

function getDefaultState() {
    const defaultProfileId = generateId('profile');
    return {
        selectedProfileId: defaultProfileId,
        profiles: [
            { id: defaultProfileId, name: 'Padrão', rows: [], config: {} }
        ]
    };
}

export function loadState() {
    try {
        const raw = getCookie(COOKIE_NAME);
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
        setCookie(COOKIE_NAME, raw, COOKIE_DAYS);
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
    const profile = { id, name: name || 'Nova Base', rows: [], config: {} };
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


