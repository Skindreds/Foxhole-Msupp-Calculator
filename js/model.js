// Computation helpers for inventory and durations

export function computeCurrentInventory(row, nowMs = Date.now()) {
    const elapsedMs = Math.max(0, nowMs - (row.updatedAtMs || nowMs));
    const hours = elapsedMs / 3600000;
    const consumed = (row.consumptionPerHour || 0) * hours;
    const current = (row.inventoryAtUpdate || 0) - consumed;
    return current > 0 ? current : 0;
}

export function computeDurationString(consumptionPerHour, inventory) {
    if (!consumptionPerHour || consumptionPerHour <= 0) return '∞';
    const totalMinutes = Math.floor((inventory / consumptionPerHour) * 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    return `${days}d${hours}h${minutes}m`;
}

export function resetRowTimestampWithCurrentInventory(row, nowMs = Date.now()) {
    // Snap inventory to the computed current value and start counting from now
    const current = computeCurrentInventory(row, nowMs);
    row.inventoryAtUpdate = current;
    row.updatedAtMs = nowMs;
}


