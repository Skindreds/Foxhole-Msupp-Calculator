import { formatDateTime, generateId, base64EncodeJson, base64DecodeJson, fileToBase64, isValidImageFile, compressImage, compressData, decompressData, uploadImageToExternal } from './utils.js';
import { loadState, saveState, getSelectedProfile, setSelectedProfile, createProfile, deleteProfile, upsertRow, deleteRow, setDesiredHours, setProfileImage, migrateFromCookies, createExportId, getExportData, cleanOldExports } from './storage.js';
import { computeCurrentInventory, computeDurationString, resetRowTimestampWithCurrentInventory } from './model.js';

// Central UI controller

export class UIController {
    constructor() {
        migrateFromCookies(); // Migrate old cookie data to localStorage
        cleanOldExports(); // Clean old export data
        this.state = loadState();
        this.profile = getSelectedProfile(this.state);
        this.elements = this.cacheElements();
        this.bindGlobalEvents();
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
        this.renderImageArea();
        this.startLiveUpdater();
        this.tryImportFromURL();
    }

    cacheElements() {
        return {
            dataBody: document.getElementById('data-body'),
            desiredHours: document.getElementById('duracao-desejada'),
            calcButton: document.getElementById('calcular-btn'),
            resultContainer: document.getElementById('resultado-container'),
            profileSelect: document.getElementById('profile-select'),
            addProfileBtn: document.getElementById('add-profile'),
            deleteProfileBtn: document.getElementById('delete-profile'),
            exportBtn: document.getElementById('exportar-json'),
            importBtn: document.getElementById('importar-json'),
            imageDisplayArea: document.getElementById('image-display-area'),
            // Modal elements
            addBaseBtn: document.getElementById('add-base-btn'),
            addBaseModal: document.getElementById('add-base-modal'),
            modalInputName: document.getElementById('modal-input-nome'),
            modalInputConsumption: document.getElementById('modal-input-consumo'),
            modalInputInventory: document.getElementById('modal-input-inventario'),
            modalAddButton: document.getElementById('modal-add-button'),
        };
    }

    bindGlobalEvents() {
        // Basic events
        if (this.elements.calcButton) {
            this.elements.calcButton.addEventListener('click', () => this.onCalc());
        }
        if (this.elements.desiredHours) {
            this.elements.desiredHours.addEventListener('input', () => this.onDesiredHoursChange());
        }
        if (this.elements.profileSelect) {
            this.elements.profileSelect.addEventListener('change', () => this.onProfileChange());
        }
        if (this.elements.addProfileBtn) {
            this.elements.addProfileBtn.addEventListener('click', () => this.onCreateProfile());
        }
        if (this.elements.deleteProfileBtn) {
            this.elements.deleteProfileBtn.addEventListener('click', () => this.onDeleteProfile());
        }
        if (this.elements.exportBtn) {
            this.elements.exportBtn.addEventListener('click', () => this.onExport());
        }
        if (this.elements.importBtn) {
            this.elements.importBtn.addEventListener('click', () => this.onImport());
        }

        // Modal events
        if (this.elements.addBaseBtn) {
            this.elements.addBaseBtn.addEventListener('click', () => this.openAddBaseModal());
        }
        if (this.elements.modalAddButton) {
            this.elements.modalAddButton.addEventListener('click', () => this.onModalAddRow());
        }

        // Modal close events
        const closeBaseModal = document.getElementById('close-base-modal');
        if (closeBaseModal) {
            closeBaseModal.addEventListener('click', () => this.closeAddBaseModal());
        }
        const cancelBaseModal = document.getElementById('cancel-base-modal');
        if (cancelBaseModal) {
            cancelBaseModal.addEventListener('click', () => this.closeAddBaseModal());
        }

        // Close modals when clicking outside
        if (this.elements.addBaseModal) {
            this.elements.addBaseModal.addEventListener('click', (e) => {
                if (e.target === this.elements.addBaseModal) this.closeAddBaseModal();
            });
        }
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
        tdActions.style.whiteSpace = 'nowrap';

        const btnUpdateInv = document.createElement('button');
        btnUpdateInv.innerHTML = '➕';
        btnUpdateInv.title = 'Atualizar MSupps no inventário';
        btnUpdateInv.style.cssText = 'padding: 5px 8px; margin-right: 5px; background-color: #28a745; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; transition: background-color 0.3s;';
        btnUpdateInv.addEventListener('mouseenter', () => btnUpdateInv.style.backgroundColor = '#218838');
        btnUpdateInv.addEventListener('mouseleave', () => btnUpdateInv.style.backgroundColor = '#28a745');
        btnUpdateInv.addEventListener('click', () => this.onUpdateInventory(row, tr));

        const btnRemove = document.createElement('button');
        btnRemove.innerHTML = '🗑️';
        btnRemove.title = 'Remover base';
        btnRemove.style.cssText = 'padding: 5px 8px; background-color: #e63946; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; transition: background-color 0.3s;';
        btnRemove.addEventListener('mouseenter', () => btnRemove.style.backgroundColor = '#d62828');
        btnRemove.addEventListener('mouseleave', () => btnRemove.style.backgroundColor = '#e63946');
        btnRemove.addEventListener('click', () => {
            deleteRow(this.profile, row.id);
            tr.remove();
            saveState(this.state);
            this.updateCalcEnablement();
        });

        tdActions.appendChild(btnUpdateInv);
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
        // This method is now handled by onModalAddRow
        this.openAddBaseModal();
    }

    onUpdateInventory(row, tr) {
        const value = prompt('Novo valor de MSupps no inventário:', String(computeCurrentInventory(row).toFixed(2)));
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

        const resultContainer = this.elements.resultContainer;
        resultContainer.innerHTML = '';

        // Add header for results
        const resultsHeader = document.createElement('h4');
        resultsHeader.style.cssText = 'margin: 0 0 15px 0; color: #ccc; font-size: 1rem;';
        resultsHeader.innerHTML = `📈 Resultado para ${hours}h`;
        resultContainer.appendChild(resultsHeader);

        const tbl = document.createElement('table');
        tbl.className = 'data-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th>Base</th>
                <th>MSupps Atuais</th>
                <th>MSupps Necessários</th>
                <th>Status</th>
            </tr>`;
        const tbody = document.createElement('tbody');
        const now = Date.now();
        this.profile.rows.forEach(row => {
            const currentInv = computeCurrentInventory(row, now);
            const needed = (row.consumptionPerHour || 0) * hours;
            const faltam = Math.max(0, needed - currentInv);
            const tr = document.createElement('tr');

            let status = '';
            let statusColor = '';
            if (faltam === 0) {
                status = '✅ OK';
                statusColor = '#28a745';
            } else {
                status = `❌ -${faltam.toFixed(0)}`;
                statusColor = '#e63946';
            }

            tr.innerHTML = `
                <td>${row.name}</td>
                <td>${Math.floor(currentInv)}</td>
                <td>${needed.toFixed(0)}</td>
                <td style="color: ${statusColor}; font-weight: bold;">${status}</td>
            `;
            tbody.appendChild(tr);
        });
        tbl.appendChild(thead);
        tbl.appendChild(tbody);
        resultContainer.appendChild(tbl);
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
        this.renderImageArea();
    }

    onCreateProfile() {
        const name = prompt('Nome do novo local:', 'Novo Local');
        const profile = createProfile(this.state, name || 'Novo Local');
        this.profile = profile;
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
        this.renderImageArea();
    }

    onDeleteProfile() {
        if (!confirm('Tem certeza que deseja remover o local atual?')) return;
        deleteProfile(this.state, this.state.selectedProfileId);
        this.profile = getSelectedProfile(this.state);
        this.renderProfileSelector();
        this.renderAllRows();
        this.applyDesiredHours();
        this.updateCalcEnablement();
        this.renderImageArea();
    }

    async onExport() {
        try {
            // Export all profiles and current selection with compression
            const data = { selectedProfileId: this.state.selectedProfileId, profiles: this.state.profiles };

            // Debug log
            console.log('Exporting data:', data);
            data.profiles.forEach(profile => {
                if (profile.image) {
                    console.log(`Profile "${profile.name}" has image:`, profile.image.substring(0, 100) + '...');
                }
            });

            // Check if there are any base64 images (local storage)
            const hasBase64Images = data.profiles.some(profile =>
                profile.image && profile.image.startsWith('data:')
            );

            // Try compression first
            const compressed = await compressData(data);
            const url = `${window.location.origin}${window.location.pathname}?c=${compressed}`;

            // More strict URL length check if there are base64 images
            const maxLength = hasBase64Images ? 4000 : 8000;

            if (url.length < maxLength) {
                navigator.clipboard.writeText(url).then(() => {
                    const message = hasBase64Images
                        ? 'Link comprimido copiado!\n\nNota: Contém imagens locais. Para URLs menores, use o upload externo de imagens.'
                        : 'Link comprimido copiado!\n\nEste link pode ser compartilhado com qualquer pessoa.';
                    alert(message);
                }).catch(() => alert('Erro ao copiar link'));
            } else {
                // URL too long - provide guidance
                if (hasBase64Images) {
                    alert('❌ URL muito longa devido às imagens armazenadas localmente!\n\n' +
                          '💡 Solução: Remova as imagens atuais e faça upload novamente.\n' +
                          'O sistema tentará usar armazenamento externo para URLs menores.\n\n' +
                          '⚠️ Exportação cancelada para evitar URLs inválidas.');
                } else {
                    // Fallback for other large data
                    const b64 = base64EncodeJson(data);
                    const fallbackUrl = `${window.location.origin}${window.location.pathname}?data=${b64}`;
                    navigator.clipboard.writeText(fallbackUrl).then(() => {
                        alert('Link copiado!\n\nAviso: Link muito longo. Considere reduzir a quantidade de dados.');
                    }).catch(() => alert('Erro ao copiar link'));
                }
            }
        } catch (error) {
            alert('Erro ao gerar link de exportação. Tente reduzir a quantidade de dados ou imagens.');
        }
    }

    async onImport() {
        const src = prompt('Cole aqui a URL exportada:');
        if (!src) return;

        let payload = null;

        try {
            const u = new URL(src);
            const params = new URLSearchParams(u.search);
            const exportId = params.get('id');
            const compressedData = params.get('c');
            const dataB64 = params.get('data');

            if (exportId) {
                // Old localStorage format (deprecated)
                payload = getExportData(exportId);
                if (!payload) {
                    alert('Link expirado ou inválido. Este formato não é mais suportado.');
                    return;
                }
            } else if (compressedData) {
                // New compressed format - try multiple decompression methods
                try {
                    payload = await decompressData(compressedData);
                } catch (decompError) {
                    console.warn('Decompression failed, trying as regular base64:', decompError);
                    // Fallback: try as regular base64
                    try {
                        payload = base64DecodeJson(compressedData);
                    } catch (fallbackError) {
                        console.error('Both decompression methods failed:', fallbackError);
                        throw new Error('Failed to decompress data');
                    }
                }
            } else if (dataB64) {
                // Uncompressed format
                payload = base64DecodeJson(dataB64);
            }
        } catch (_) {
            // Try to extract from string directly
            if (src.includes('c=')) {
                const compMatch = src.match(/c=([^&]+)/);
                if (compMatch) {
                    try {
                        payload = await decompressData(compMatch[1]);
                    } catch (decompError) {
                        console.warn('Manual decompression failed, trying as regular base64:', decompError);
                        try {
                            payload = base64DecodeJson(compMatch[1]);
                        } catch (fallbackError) {
                            alert('Erro ao descomprimir dados');
                            return;
                        }
                    }
                }
            } else if (src.includes('data=')) {
                const dataMatch = src.match(/data=([^&]+)/);
                if (dataMatch) {
                    payload = base64DecodeJson(dataMatch[1]);
                }
            }
        }

        if (!payload) {
            alert('Formato de link inválido');
            return;
        }

        if (!confirm('Importar dados e substituir os atuais?')) return;

        // Debug log
        console.log('Importing data:', payload);
        payload.profiles.forEach(profile => {
            if (profile.image) {
                console.log(`Importing profile "${profile.name}" with image:`, profile.image.substring(0, 100) + '...');
            }
        });

        this.state.selectedProfileId = payload.selectedProfileId;
        this.state.profiles = payload.profiles || [];
        saveState(this.state);
        this.renderProfileSelector();
        this.onProfileChange();
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
        }, 300000); // 5 minutos
    }

    async tryImportFromURL() {
        const params = new URLSearchParams(window.location.search);
        const exportId = params.get('id');
        const compressedData = params.get('c');
        const base64 = params.get('data');

        let payload = null;
        let paramToClean = null;

        try {
            if (exportId) {
                payload = getExportData(exportId);
                paramToClean = 'id';
                if (!payload) {
                    alert('Link expirado ou inválido.');
                    return;
                }
            } else if (compressedData) {
                try {
                    payload = await decompressData(compressedData);
                    paramToClean = 'c';
                } catch (decompError) {
                    console.warn('Auto-import decompression failed, trying as regular base64:', decompError);
                    try {
                        payload = base64DecodeJson(compressedData);
                        paramToClean = 'c';
                    } catch (fallbackError) {
                        console.error('Auto-import: both decompression methods failed:', fallbackError);
                        return;
                    }
                }
            } else if (base64) {
                payload = base64DecodeJson(base64);
                paramToClean = 'data';
            }
        } catch (_) {
            return;
        }

        if (!payload) return;

        if (!confirm('Detectamos dados na URL. Deseja importar e substituir os atuais?')) return;

        // Debug log
        console.log('Auto-importing from URL:', payload);
        payload.profiles.forEach(profile => {
            if (profile.image) {
                console.log(`Auto-importing profile "${profile.name}" with image:`, profile.image.substring(0, 100) + '...');
            }
        });

        this.state.selectedProfileId = payload.selectedProfileId;
        this.state.profiles = payload.profiles || [];
        saveState(this.state);

        // Clean URL
        const url = new URL(window.location.href);
        url.searchParams.delete(paramToClean);
        window.history.replaceState({}, '', url.toString());

        this.renderProfileSelector();
        this.onProfileChange();
    }

    renderImageArea() {
        const container = this.elements.imageDisplayArea;
        container.innerHTML = '';

        if (this.profile.image) {
            // Debug log
            console.log('Rendering image for profile:', this.profile.name, 'Image URL:', this.profile.image);

            // Show existing image
            const imageContainer = document.createElement('div');
            imageContainer.className = 'base-image-container';

            const img = document.createElement('img');
            img.src = this.profile.image;
            img.className = 'base-image';
            img.alt = `Imagem da base ${this.profile.name}`;

            // Add error handling for broken images
            img.onerror = () => {
                console.error('Failed to load image:', this.profile.image);
                img.style.display = 'none';
                const errorMsg = document.createElement('p');
                errorMsg.textContent = '❌ Imagem não pôde ser carregada';
                errorMsg.style.color = '#e63946';
                imageContainer.appendChild(errorMsg);
            };

            img.onload = () => {
                console.log('Image loaded successfully:', this.profile.image);
            };

            imageContainer.appendChild(img);

            const controls = document.createElement('div');
            controls.className = 'image-controls';

            const changeBtn = document.createElement('button');
            changeBtn.textContent = 'Alterar Imagem';
            changeBtn.addEventListener('click', () => this.onImageUpload());

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remover Imagem';
            removeBtn.style.backgroundColor = '#e63946';
            removeBtn.addEventListener('click', () => this.onImageRemove());

            // Add migrate button for base64 images
            if (this.profile.image && this.profile.image.startsWith('data:')) {
                const migrateBtn = document.createElement('button');
                migrateBtn.textContent = '🌐 Migrar para Externo';
                migrateBtn.style.backgroundColor = '#28a745';
                migrateBtn.title = 'Migrar imagem para servidor externo (URLs menores)';
                migrateBtn.addEventListener('click', () => this.onMigrateImage());
                controls.appendChild(migrateBtn);
            }

            controls.appendChild(changeBtn);
            controls.appendChild(removeBtn);

            container.appendChild(imageContainer);
            container.appendChild(controls);
        } else {
            // Show upload area
            const uploadArea = document.createElement('div');
            uploadArea.className = 'image-upload-area';
            uploadArea.innerHTML = `
                <div>
                    <p>📷 Clique para adicionar uma imagem para este local</p>
                </div>
            `;
            uploadArea.addEventListener('click', () => this.onImageUpload());
            container.appendChild(uploadArea);
        }
    }

    onImageUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file || !isValidImageFile(file)) {
                alert('Por favor, selecione um arquivo de imagem válido.');
                return;
            }

            if (file.size > 10 * 1024 * 1024) { // 10MB limit for original
                alert('A imagem deve ter no máximo 10MB.');
                return;
            }

            try {
                // Show loading message
                const container = this.elements.imageDisplayArea;
                container.innerHTML = '<p>📤 Tentando upload para servidores externos...</p>';

                // Try external upload first
                try {
                    const uploadResult = await uploadImageToExternal(file);
                    setProfileImage(this.profile, uploadResult.url);
                    saveState(this.state);
                    this.renderImageArea();

                    // Upload successful, no alert needed
                    return;
                } catch (externalError) {
                    console.warn('External upload failed, falling back to local storage:', externalError);
                    container.innerHTML = '<p>⚠️ Servidores externos falharam, comprimindo localmente...</p>';

                    // External services failed, proceeding with local compression
                }

                // Fallback to compressed base64
                const compressedDataUrl = await compressImage(file, 600, 0.5);
                setProfileImage(this.profile, compressedDataUrl);
                saveState(this.state);
                this.renderImageArea();

                // Fallback upload completed, no alert needed

            } catch (error) {
                alert('Erro ao processar a imagem.');
                this.renderImageArea(); // Restore original state
            }
        });
        input.click();
    }

    onImageRemove() {
        if (!confirm('Tem certeza que deseja remover a imagem deste local?')) return;
        setProfileImage(this.profile, null);
        saveState(this.state);
        this.renderImageArea();
    }

    async onMigrateImage() {
        if (!this.profile.image || !this.profile.image.startsWith('data:')) return;

        if (!confirm('Migrar imagem para servidor externo?\n\nIsso reduzirá significativamente o tamanho das URLs de exportação.')) return;

        try {
            // Show loading message
            const container = this.elements.imageDisplayArea;
            const originalContent = container.innerHTML;
            container.innerHTML = '<p>🌐 Migrando imagem para servidor externo...</p>';

            // Convert data URL to blob
            const response = await fetch(this.profile.image);
            const blob = await response.blob();

            // Create a File object from the blob
            const file = new File([blob], 'migrated-image.jpg', { type: blob.type });

            // Upload to external service
            const uploadResult = await uploadImageToExternal(file);
            setProfileImage(this.profile, uploadResult.url);
            saveState(this.state);
            this.renderImageArea();

            alert('✅ Imagem migrada com sucesso!\n\nAgora as URLs de exportação serão muito menores.');

        } catch (error) {
            console.error('Migration failed:', error);
            alert('❌ Falha na migração da imagem.\n\nO servidor externo pode estar indisponível. Tente novamente mais tarde.');
            this.renderImageArea(); // Restore original state
        }
    }

    onImageFromURL() {
        const url = prompt('Cole a URL da imagem:\n\n' +
                          '🌐 OPÇÃO 1 - GitHub (mais confiável):\n' +
                          '1. Acesse github.com e faça login\n' +
                          '2. Vá em qualquer repositório seu\n' +
                          '3. Clique "Issues" → "New Issue"\n' +
                          '4. Arraste sua imagem para o texto\n' +
                          '5. Copie a URL que aparece (ex: https://github.com/user/repo/assets/...)\n\n' +
                          '🖼️ OPÇÃO 2 - Imgur:\n' +
                          '1. Acesse imgur.com\n' +
                          '2. Faça upload da imagem\n' +
                          '3. Copie a URL direta da imagem\n\n' +
                          'URL da imagem:');

        if (!url) return;

        // Basic URL validation
        try {
            new URL(url);
        } catch {
            alert('URL inválida. Por favor, insira uma URL válida.');
            return;
        }

        // Check if it looks like an image URL
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const hasImageExtension = imageExtensions.some(ext =>
            url.toLowerCase().includes(ext)
        );

        const isImageHost = ['imgur.com', 'imgbb.com', 'postimg.cc', 'i.ibb.co', 'postimages.org'].some(host =>
            url.toLowerCase().includes(host)
        );

        if (!hasImageExtension && !isImageHost) {
            const proceed = confirm('A URL não parece ser de uma imagem.\n\nDeseja continuar mesmo assim?');
            if (!proceed) return;
        }

        // Test if image loads
        const testImg = new Image();
        testImg.onload = () => {
            setProfileImage(this.profile, url);
            saveState(this.state);
            this.renderImageArea();
        };

        testImg.onerror = () => {
            alert('❌ Não foi possível carregar a imagem desta URL.\n\n' +
                  'Verifique se:\n' +
                  '• A URL está correta\n' +
                  '• A imagem existe\n' +
                  '• O servidor permite acesso externo (CORS)');
        };

        // Show loading state
        const container = this.elements.imageDisplayArea;
        container.innerHTML = '<p>🔍 Verificando imagem...</p>';

        testImg.src = url;
    }

    // Modal management methods
    openAddBaseModal() {
        if (this.elements.addBaseModal) {
            this.elements.addBaseModal.style.display = 'block';
        }
        if (this.elements.modalInputName) {
            this.elements.modalInputName.focus();
        }
    }

    closeAddBaseModal() {
        if (this.elements.addBaseModal) {
            this.elements.addBaseModal.style.display = 'none';
        }
        // Clear inputs
        if (this.elements.modalInputName) {
            this.elements.modalInputName.value = '';
        }
        if (this.elements.modalInputConsumption) {
            this.elements.modalInputConsumption.value = '';
        }
        if (this.elements.modalInputInventory) {
            this.elements.modalInputInventory.value = '';
        }
    }


    onModalAddRow() {
        if (!this.elements.modalInputName || !this.elements.modalInputConsumption || !this.elements.modalInputInventory) {
            alert('Erro: elementos do modal não encontrados.');
            return;
        }

        const name = String(this.elements.modalInputName.value || '').trim();
        const cons = parseFloat(this.elements.modalInputConsumption.value);
        const inv = parseFloat(this.elements.modalInputInventory.value);
        if (!name || !Number.isFinite(cons) || !Number.isFinite(inv)) {
            alert('Por favor, preencha todos os campos corretamente.');
            return;
        }

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
        if (this.elements.dataBody) {
            this.elements.dataBody.appendChild(tr);
        }
        this.updateCalcEnablement();

        this.closeAddBaseModal();
    }

}


