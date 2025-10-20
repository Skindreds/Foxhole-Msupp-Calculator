import { formatDateTime, generateId, base64EncodeJson, base64DecodeJson } from './utils.js';
import { loadState, saveState, getSelectedProfile, setSelectedProfile, createProfile, deleteProfile, upsertRow, deleteRow, setDesiredHours } from './storage.js';
import { computeCurrentInventory, computeDurationString, resetRowTimestampWithCurrentInventory } from './model.js';

// Central UI controller

export class UIController {
    constructor() {
        this.state = loadState();
        this.profile = getSelectedProfile(this.state);
        this.elements = this.cacheElements();
        this.bindGlobalEvents();
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
        this.startLiveUpdater();
        this.tryImportFromURL();
    }

    cacheElements() {
        return {
            addButton: document.getElementById('add-button'),
            inputName: document.querySelector('.input-nome'),
            inputConsumption: document.querySelector('.input-consumo'),
            inputInventory: document.querySelector('.input-inventario'),
            dataBody: document.getElementById('data-body'),
            desiredHours: document.getElementById('duracao-desejada'),
            calcButton: document.getElementById('calcular-btn'),
            resultContainer: document.getElementById('resultado-container'),
            profileSelect: document.getElementById('profile-select'),
            addProfileBtn: document.getElementById('add-profile'),
            deleteProfileBtn: document.getElementById('delete-profile'),
            exportBtn: document.getElementById('exportar-json'),
            importBtn: document.getElementById('importar-json'),
        };
    }

    bindGlobalEvents() {
        this.elements.addButton.addEventListener('click', () => this.onAddRow());
        this.elements.calcButton.addEventListener('click', () => this.onCalc());
        this.elements.desiredHours.addEventListener('input', () => this.onDesiredHoursChange());
        this.elements.profileSelect.addEventListener('change', () => this.onProfileChange());
        this.elements.addProfileBtn.addEventListener('click', () => this.onCreateProfile());
        this.elements.deleteProfileBtn.addEventListener('click', () => this.onDeleteProfile());
        this.elements.exportBtn.addEventListener('click', () => this.onExport());
        this.elements.importBtn.addEventListener('click', () => this.onImport());
    }

    renderProfileSelector() {
        const sel = this.elements.profileSelect;
        sel.innerHTML = '';
        this.state.profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === this.state.selectedProfileId) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    renderAllRows() {
        this.profile = getSelectedProfile(this.state);
        const tbody = this.elements.dataBody;
        tbody.innerHTML = '';
        this.profile.rows.forEach(row => {
            tbody.appendChild(this.createRowElement(row));
        });
    }

    applyDesiredHours() {
        const hours = this.profile.config.desiredHours;
        if (typeof hours === 'number' && !Number.isNaN(hours)) {
            this.elements.desiredHours.value = String(hours);
        }
    }

    updateCalcEnablement() {
        const hasRows = (this.profile.rows.length > 0);
        this.elements.desiredHours.disabled = !hasRows;
        this.elements.calcButton.disabled = !hasRows;
    }

    createEditableCell(text, onChange) {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        td.textContent = text;
        td.addEventListener('input', () => {
            onChange(td.textContent);
        });
        return td;
    }

    createRowElement(row) {
        const tr = document.createElement('tr');

        // Nome (editável)
        const tdName = this.createEditableCell(row.name || '', (val) => {
            row.name = String(val);
            upsertRow(this.profile, row);
            saveState(this.state);
        });

        // Consumo/h (editável): ao mudar, consolidar inventário para preservar o consumo anterior
        const tdCons = this.createEditableCell(String(row.consumptionPerHour || 0), (val) => {
            const num = parseFloat(val);
            if (!Number.isFinite(num) || num < 0) return;
            // Snap inventory with old rate, then change rate
            resetRowTimestampWithCurrentInventory(row);
            row.consumptionPerHour = num;
            upsertRow(this.profile, row);
            this.refreshRowComputedCells(tr, row);
            saveState(this.state);
        });

        // Inventário (somente leitura, com consumo em tempo real)
        const tdInv = document.createElement('td');
        tdInv.dataset.type = 'inventory';
        tdInv.style.cursor = 'default';

        // Atualizado em
        const tdUpdated = document.createElement('td');
        tdUpdated.dataset.type = 'updated';

        // Duração calculada
        const tdDur = document.createElement('td');
        tdDur.dataset.type = 'duration';

        // Ações
        const tdActions = document.createElement('td');
        const btnUpdateInv = document.createElement('button');
        btnUpdateInv.textContent = 'Atualizar Inv.';
        btnUpdateInv.addEventListener('click', () => this.onUpdateInventory(row, tr));
        const btnRemove = document.createElement('button');
        btnRemove.className = 'remove-btn';
        btnRemove.addEventListener('click', () => {
            deleteRow(this.profile, row.id);
            tr.remove();
            saveState(this.state);
            this.updateCalcEnablement();
        });
        tdActions.appendChild(btnUpdateInv);
        tdActions.appendChild(document.createTextNode(' '));
        tdActions.appendChild(btnRemove);

        tr.appendChild(tdName);
        tr.appendChild(tdCons);
        tr.appendChild(tdInv);
        tr.appendChild(tdUpdated);
        tr.appendChild(tdDur);
        tr.appendChild(tdActions);

        this.refreshRowComputedCells(tr, row);
        return tr;
    }

    refreshRowComputedCells(tr, row) {
        const now = Date.now();
        const invCell = tr.querySelector('td[data-type="inventory"]');
        const updCell = tr.querySelector('td[data-type="updated"]');
        const durCell = tr.querySelector('td[data-type="duration"]');

        const currentInv = computeCurrentInventory(row, now);
        invCell.textContent = String(Math.floor(currentInv));
        updCell.textContent = formatDateTime(row.updatedAtMs || now);
        durCell.textContent = computeDurationString(row.consumptionPerHour || 0, currentInv);
    }

    onAddRow() {
        const name = String(this.elements.inputName.value || '').trim();
        const cons = parseFloat(this.elements.inputConsumption.value);
        const inv = parseFloat(this.elements.inputInventory.value);
        if (!name || !Number.isFinite(cons) || !Number.isFinite(inv)) return;

        const now = Date.now();
        const row = {
            id: generateId('row'),
            name,
            consumptionPerHour: cons,
            inventoryAtUpdate: inv,
            updatedAtMs: now,
        };
        upsertRow(this.profile, row);
        saveState(this.state);

        const tr = this.createRowElement(row);
        this.elements.dataBody.appendChild(tr);
        this.updateCalcEnablement();

        // Clear inputs
        this.elements.inputName.value = '';
        this.elements.inputConsumption.value = '';
        this.elements.inputInventory.value = '';
    }

    onUpdateInventory(row, tr) {
        const value = prompt('Novo valor de inventário:', String(computeCurrentInventory(row).toFixed(2)));
        if (value === null) return;
        const num = parseFloat(value);
        if (!Number.isFinite(num) || num < 0) return;
        row.inventoryAtUpdate = num;
        row.updatedAtMs = Date.now();
        upsertRow(this.profile, row);
        this.refreshRowComputedCells(tr, row);
        saveState(this.state);
    }

    onCalc() {
        const hours = parseFloat(this.elements.desiredHours.value);
        if (!Number.isFinite(hours) || hours <= 0) return;
        const tbl = document.createElement('table');
        tbl.className = 'data-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Nome</th>
                <th>Inventário</th>
                <th>Faltam</th>
            </tr>`;
        const tbody = document.createElement('tbody');
        const now = Date.now();
        this.profile.rows.forEach(row => {
            const currentInv = computeCurrentInventory(row, now);
            const needed = (row.consumptionPerHour || 0) * hours;
            const faltam = Math.max(0, needed - currentInv);
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.name}</td><td>${Math.floor(currentInv)}</td><td>${faltam.toFixed(2)}</td>`;
            tbody.appendChild(tr);
        });
        tbl.appendChild(thead);
        tbl.appendChild(tbody);
        this.elements.resultContainer.innerHTML = '';
        this.elements.resultContainer.appendChild(tbl);
    }

    onDesiredHoursChange() {
        const hours = parseFloat(this.elements.desiredHours.value);
        if (Number.isFinite(hours) && hours >= 0) {
            setDesiredHours(this.profile, hours);
            saveState(this.state);
        }
    }

    onProfileChange() {
        const id = this.elements.profileSelect.value;
        setSelectedProfile(this.state, id);
        this.profile = getSelectedProfile(this.state);
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
    }

    onCreateProfile() {
        const name = prompt('Nome da nova base:', 'Nova Base');
        const profile = createProfile(this.state, name || 'Nova Base');
        this.profile = profile;
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
    }

    onDeleteProfile() {
        if (!confirm('Tem certeza que deseja remover a base atual?')) return;
        deleteProfile(this.state, this.state.selectedProfileId);
        this.profile = getSelectedProfile(this.state);
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
    }

    onExport() {
        // Export all profiles and current selection into URL param
        const data = { selectedProfileId: this.state.selectedProfileId, profiles: this.state.profiles };
        const b64 = base64EncodeJson(data);
        const url = `${window.location.origin}${window.location.pathname}?data=${b64}`;
        navigator.clipboard.writeText(url).then(() => alert('Link copiado para a área de transferência')).catch(() => alert('Erro ao copiar link'));
    }

    onImport() {
        const src = prompt('Cole aqui a URL exportada (ou apenas o valor de data=):');
        if (!src) return;
        let b64 = src;
        try {
            const u = new URL(src);
            b64 = new URLSearchParams(u.search).get('data') || src;
        } catch (_) {
            // not a full URL
            const qsIdx = src.indexOf('data=');
            if (qsIdx >= 0) b64 = src.slice(qsIdx + 5);
        }
        try {
            const payload = base64DecodeJson(b64);
            if (!confirm('Importar dados e substituir os atuais?')) return;
            this.state.selectedProfileId = payload.selectedProfileId;
            this.state.profiles = payload.profiles || [];
            saveState(this.state);
            this.renderProfileSelector();
            this.onProfileChange();
        } catch (e) {
            alert('Falha ao importar');
        }
    }

    startLiveUpdater() {
        // Update computed cells periodically
        setInterval(() => {
            const rows = this.elements.dataBody.querySelectorAll('tr');
            rows.forEach((trEl) => {
                // Find row by index (stable order)
                const idx = Array.from(rows).indexOf(trEl);
                const row = this.profile.rows[idx];
                if (!row) return;
                this.refreshRowComputedCells(trEl, row);
            });
        }, 30000); // 30s
    }

    tryImportFromURL() {
        const params = new URLSearchParams(window.location.search);
        const base64 = params.get('data');
        if (!base64) return;
        try {
            const payload = base64DecodeJson(base64);
            if (!confirm('Detectamos dados na URL. Deseja importar e substituir os atuais?')) return;
            this.state.selectedProfileId = payload.selectedProfileId;
            this.state.profiles = payload.profiles || [];
            saveState(this.state);
            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('data');
            window.history.replaceState({}, '', url.toString());
            this.renderProfileSelector();
            this.onProfileChange();
        } catch (_) {
            // ignore
        }
    }
}


