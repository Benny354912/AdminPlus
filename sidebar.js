// AdminPlus - Sidebar Navigation
(function () {
    'use strict';

    // Debug-Modus - Aktiviere für Debugging
    const DEBUG = true;

    const log = (msg, data) => {
        if (!DEBUG) return;
        if (data) {
            console.log('%c[EasyLogin]', 'color: #1e88e5; font-weight: bold;', msg, data);
        } else {
            console.log('%c[EasyLogin]', 'color: #1e88e5; font-weight: bold;', msg);
        }
    };

    let allUsers = [];
    let filteredUsers = [];
    let selectedUsers = new Set();
    let currentPage = 1;
    let pageSize = 25;
    let authState = null;
    let authInitialized = false;
    let totalUsersCount = 0;
    let settings = {
        showCutlines: true,
        senderAddress: ''
    };
    let easyLoginPeer = null;
    let easyLoginConnection = null;
    let easyLoginReady = false;
    let easyLoginOldPeer = null;
    let easyLoginOldConnection = null;
    let easyLoginRefreshInterval = null;
    let easyLoginQrCode = null;
    let sidebarVisible = false;
    let pending2FAData = null; // Speichert ausstehende 2FA-Daten
    let waiting2FAFromPWA = false; // Wartet auf 2FA-Antwort von PWA
    let easyLoginKeyPair = null; // Public/Private Key Paar für Verschlüsselung
    let remotePWAPublicKey = null; // Public Key der PWA

    // Initialisierung wenn DOM geladen ist
    document.addEventListener('DOMContentLoaded', init);

    // Überwache Sidebar-Sichtbarkeit
    document.addEventListener('visibilitychange', handleVisibilityChange);

    function init() {
        console.log('AdminPlus Sidebar geladen');
        sidebarVisible = !document.hidden;
        
        // Navigation Event Listeners
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => handleNavigation(item));
        });

        // Button Event Listeners
        setupButtonHandlers();
        setupAddressHandlers();
        loadSettings();
        setupEasyLoginHandlers();

        // Standardmäßig nicht angemeldet, bis Status kommt
        applyAuthState({ loggedIn: false });

        // Auth-Status beim Parent anfragen
        requestAuthStatus();

        // Auth-Status vom Parent empfangen
        window.addEventListener('message', handleAuthMessage);
    }

    function handleNavigation(clickedItem) {
        const targetPage = clickedItem.dataset.page;

        if (!isPageAllowed(targetPage)) {
            setActivePage('start');
            return;
        }

        // Alle Navigation Items deaktivieren
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Geklicktes Item aktivieren
        clickedItem.classList.add('active');
        
        // Alle Seiten verstecken
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Zielseite anzeigen
        const targetPageElement = document.getElementById(`page-${targetPage}`);
        if (targetPageElement) {
            targetPageElement.classList.add('active');
            console.log(`Navigation zu: ${targetPage}`);
            
            // Lade User wenn Adressen-Seite
            if (targetPage === 'adressen' && authState?.loggedIn && allUsers.length === 0) {
                loadUsers();
            }
        }
    }

    function setActivePage(pageKey) {
        const targetItem = document.querySelector(`.nav-item[data-page="${pageKey}"]`);
        if (targetItem) {
            handleNavigation(targetItem);
        } else {
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            const fallback = document.getElementById('page-start');
            fallback?.classList.add('active');
        }
    }

    function isPageAllowed(pageKey) {
        const loggedIn = document.body.dataset.loggedIn === 'true';
        if (!loggedIn && pageKey !== 'start') {
            return false;
        }
        return true;
    }

    function requestAuthStatus() {
        if (window.parent) {
            window.parent.postMessage({ type: 'AdminPlusRequestAuth' }, '*');
        }
    }

    function handleAuthMessage(event) {
        const data = event?.data;
        if (data?.type === 'AdminPlusAuth') {
            authInitialized = true;
            authState = data.payload || { loggedIn: false };
            applyAuthState(authState);
            
            // Lade User wenn auf Adressen-Seite und angemeldet
            if (authState.loggedIn) {
                const currentPageId = document.querySelector('.page.active')?.id;
                if (currentPageId === 'page-adressen' && allUsers.length === 0) {
                    loadUsers();
                }
            }
        } else if (data?.type === 'AdminPlusSessionId') {
            // Session ID wird über Promise in getSessionId behandelt
        } else if (data?.type === 'AdminPlusRequestSessionId') {
            // Relay: arbeitszeit iframe fragt nach Session-ID
            // Weiterleiten zum parent und Antwort zurückgeben
            handleSessionIdRequest(event.source);
        }
    }

    function handleSessionIdRequest(sourceWindow) {
        // Frage parent nach Session-ID
        window.parent.postMessage({ type: 'AdminPlusRequestSessionId' }, '*');
        
        const handler = (event) => {
            if (event?.data?.type === 'AdminPlusSessionId') {
                window.removeEventListener('message', handler);
                // Gebe Antwort an arbeitszeit iframe zurück
                sourceWindow.postMessage({
                    type: 'AdminPlusSessionId',
                    sessionId: event.data.sessionId || ''
                }, '*');
            }
        };
        
        window.addEventListener('message', handler);
        
        // Timeout nach 3 Sekunden
        setTimeout(() => {
            window.removeEventListener('message', handler);
        }, 3000);
    }

    function applyAuthState(state) {
        const loggedIn = !!state?.loggedIn;
        document.body.dataset.loggedIn = loggedIn ? 'true' : 'false';

        const navAdressen = document.querySelector('.nav-item[data-page="adressen"]');
        if (navAdressen) {
            navAdressen.classList.toggle('hidden', !loggedIn);
        }

        const navArbeitszeit = document.querySelector('.nav-item[data-page="arbeitszeit"]');
        if (navArbeitszeit) {
            navArbeitszeit.classList.toggle('hidden', !loggedIn);
        }

        const loginRequiredText = document.getElementById('login-required-text');
        const loginSuccessContainer = document.getElementById('login-success-container');
        const userFullName = document.getElementById('user-fullname');
        const instanceName = document.getElementById('instance-name');
        const instanceNameText = document.getElementById('instance-name-text');
        const instanceLogo = document.getElementById('instance-logo');
        const profilePicture = document.getElementById('profile-picture');

        if (loggedIn) {
            const name = state?.user?.fullName || state?.user?.name || 'Unbekannt';
            if (userFullName) userFullName.textContent = name;

            // Instanz-Informationen anzeigen
            if (state?.instance?.name && instanceName) {
                instanceName.textContent = state.instance.name;
                instanceNameText?.classList.remove('hidden');
            } else {
                instanceNameText?.classList.add('hidden');
            }

            if (state?.instance?.image && instanceLogo) {
                instanceLogo.src = state.instance.image;
                instanceLogo.classList.remove('hidden');
            } else {
                instanceLogo?.classList.add('hidden');
            }

            if (state?.user?.profilePicture && profilePicture) {
                profilePicture.src = state.user.profilePicture;
                profilePicture.classList.remove('hidden');
            } else {
                profilePicture?.classList.add('hidden');
            }

            loginRequiredText?.classList.add('hidden');
            loginSuccessContainer?.classList.remove('hidden');
        } else {
            loginRequiredText?.classList.remove('hidden');
            loginSuccessContainer?.classList.add('hidden');
        }

        if (!loggedIn) {
            setActivePage('start');
        }

        if (authInitialized) {
            toggleEasyLoginBox(loggedIn);
            if (!loggedIn) {
                setEasyLoginMeta({ peerId: easyLoginPeer?.id || '---' });
                refreshEasyLoginQr();
            }
        }
    }

    function setupButtonHandlers() {
        // Alle Buttons mit Event Listenern versehen
        const buttons = document.querySelectorAll('button.btn-primary, button.btn-secondary');
        buttons.forEach(button => {
            if (!button.id) { // Nur Buttons ohne spezifische ID
                button.addEventListener('click', function() {
                    showNotification(this.textContent + ' - Funktion in Entwicklung');
                });
            }
        });
    }

    function showNotification(message) {
        // Einfache Benachrichtigung erstellen
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #323232;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Nach 3 Sekunden entfernen
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ==================== Easy Login ====================

    function setupEasyLoginHandlers() {
        document.getElementById('refresh-qr')?.addEventListener('click', () => {
            initEasyLoginPeer(true);
        });
        
        // 2FA Modal Handlers
        document.getElementById('submit-easy-login-2fa')?.addEventListener('click', handleEasyLogin2FASubmit);
        document.getElementById('cancel-easy-login-2fa')?.addEventListener('click', hideEasyLogin2FAModal);
        
        // Enter-Taste im 2FA-Eingabefeld
        document.getElementById('easy-login-2fa-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleEasyLogin2FASubmit();
            }
        });
    }

    function toggleEasyLoginBox(loggedIn) {
        const box = document.getElementById('easy-login-box');
        if (!box) return;

        if (loggedIn) {
            box.classList.add('hidden');
            destroyEasyLoginPeer();
            stopEasyLoginAutoRefresh();
            return;
        }

        box.classList.remove('hidden');
        initEasyLoginPeer(false);
        startEasyLoginAutoRefresh();
    }

    function initEasyLoginPeer(forceNew) {
        if (authState?.loggedIn) {
            return;
        }

        if (easyLoginPeer && !forceNew) {
            refreshEasyLoginQr();
            return;
        }

        // Alte Peer-ID behalten für Overlap-Zeitraum (15s)
        if (easyLoginPeer && forceNew) {
            easyLoginOldPeer = easyLoginPeer;
            easyLoginOldConnection = easyLoginConnection;
            setTimeout(() => {
                if (easyLoginOldPeer) {
                    try { easyLoginOldPeer.destroy(); } catch {}
                    easyLoginOldPeer = null;
                    easyLoginOldConnection = null;
                }
            }, 15000); // 15 Sekunden Overlap
        }

        easyLoginPeer = null;
        easyLoginConnection = null;
        easyLoginReady = false;
        updateEasyLoginStatus('Initialisiere…');

        if (typeof Peer === 'undefined') {
            updateEasyLoginStatus('PeerJS nicht verfügbar', 'danger');
            return;
        }

        easyLoginPeer = new Peer({
            host: '0.peerjs.com',
            port: 443,
            secure: true
        });

        easyLoginPeer.on('open', (id) => {
            easyLoginReady = true;
            setEasyLoginMeta({ peerId: id });
            refreshEasyLoginQr();
            updateEasyLoginStatus('Bereit – warte auf Verbindung');
        });

        easyLoginPeer.on('connection', (conn) => {
            log('Neue Verbindung von PWA erhalten');
            easyLoginConnection = conn;
            updateEasyLoginStatus('Verbunden', 'success');
            hideQrCode();

            conn.on('open', () => {
                log('Connection vollständig offen, initialisiere Verschlüsselung');
                // Initialisiere Verschlüsselung für diese Verbindung
                initializeConnectionEncryption(conn);
            });

            conn.on('data', (data) => {
                log('Daten empfangen:', data?.type);
                handleEasyLoginDataEncrypted(data);
            });
            conn.on('close', () => {
                log('Verbindung geschlossen');
                updateEasyLoginStatus('Verbindung getrennt', 'warning');
                easyLoginConnection = null;
                easyLoginKeyPair = null;
                remotePWAPublicKey = null;
                showQrCode();
            });
            conn.on('error', (err) => {
                log('Verbindungsfehler:', err);
            });
        });

        easyLoginPeer.on('error', (err) => {
            console.error('EasyLogin PeerJS Fehler:', err);
            updateEasyLoginStatus('Fehler bei PeerJS', 'danger');
        });
    }

    function destroyEasyLoginPeer() {
        if (easyLoginConnection) {
            try { easyLoginConnection.close(); } catch {}
            easyLoginConnection = null;
        }
        if (easyLoginPeer) {
            try { easyLoginPeer.destroy(); } catch {}
            easyLoginPeer = null;
        }
        if (easyLoginOldConnection) {
            try { easyLoginOldConnection.close(); } catch {}
            easyLoginOldConnection = null;
        }
        if (easyLoginOldPeer) {
            try { easyLoginOldPeer.destroy(); } catch {}
            easyLoginOldPeer = null;
        }
        easyLoginReady = false;
        setEasyLoginMeta({ peerId: '---' });
        if (easyLoginQrCode) {
            easyLoginQrCode.clear();
            easyLoginQrCode = null;
        }
    }

    function updateEasyLoginStatus(text, type) {
        const statusEl = document.getElementById('easy-login-status');
        if (!statusEl) return;

        statusEl.textContent = text;
        statusEl.classList.remove('success', 'warning', 'danger');
        if (type) statusEl.classList.add(type);
    }

    function setEasyLoginMeta({ peerId }) {
        const peerEl = document.getElementById('easy-login-peer');
        const instanceEl = document.getElementById('easy-login-instance');
        const hostName = authState?.instance?.hostName || authState?.instance?.host_name || 'Unbekannt';

        if (peerEl) peerEl.textContent = peerId || '---';
        if (instanceEl) instanceEl.textContent = hostName || 'Unbekannt';
    }

    function buildEasyLoginPayload() {
        const hostName = authState?.instance?.hostName || authState?.instance?.host_name || '';
        const lastRef = authState?.instance?.lastRef || hostName || '';

        return {
            v: 1,
            peerId: easyLoginPeer?.id || '',
            host: hostName,
            ref: lastRef
        };
    }

    function refreshEasyLoginQr() {
        const qrDiv = document.getElementById('easy-login-qr');
        if (!qrDiv || !easyLoginReady || !easyLoginPeer?.id) return;

        // Kein QR-Code wenn bereits verbunden
        if (isConnected()) {
            hideQrCode();
            return;
        }

        const payload = buildEasyLoginPayload();
        const dataString = JSON.stringify(payload);

        // QR-Code lokal generieren
        if (typeof QRCode === 'undefined') {
            console.error('QRCode Bibliothek nicht verfügbar');
            return;
        }

        // Alten QR-Code entfernen
        if (easyLoginQrCode) {
            easyLoginQrCode.clear();
            qrDiv.replaceChildren();
        }

        // Neuen QR-Code erstellen
        easyLoginQrCode = new QRCode(qrDiv, {
            text: dataString,
            width: 260,
            height: 260,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        showQrCode();
    }

    function isConnected() {
        return (easyLoginConnection && easyLoginConnection.open) || 
               (easyLoginOldConnection && easyLoginOldConnection.open);
    }

    function hideQrCode() {
        const qrWrapper = document.querySelector('.qr-image-wrapper');
        if (qrWrapper) {
            qrWrapper.style.display = 'none';
        }
    }

    function showQrCode() {
        const qrWrapper = document.querySelector('.qr-image-wrapper');
        if (qrWrapper && !isConnected()) {
            qrWrapper.style.display = 'flex';
        }
    }

    function handleEasyLoginData(data) {
        log('Daten von PWA erhalten:', data);
        if (!data || typeof data !== 'object') {
            log('Ungueltige Daten');
            return;
        }

        if (data.type === 'EasyLoginResponse') {
            log('EasyLoginResponse erhalten - success:', data.success, 'missing2fa:', data.missing2fa);
            
            // Fall 1: Login erfolgreich (mit oder ohne 2FA)
            // Dies kann entweder der initiale Login oder eine nachträgliche 2FA-Antwort von der PWA sein
            if (data.success) {
                updateEasyLoginStatus('Login erfolgreich', 'success');
                showNotification('Easy Login erfolgreich');
                
                // Wenn wir auf eine 2FA-Antwort von PWA gewartet haben, Modal schließen
                if (waiting2FAFromPWA) {
                    log('2FA wurde auf PWA-Gerät erfolgreich eingegeben');
                    hideEasyLogin2FAModal();
                }
                
                pending2FAData = null;
                waiting2FAFromPWA = false;

                if (window.parent) {
                    log('Sende EasyLoginSession zum Parent');
                    window.parent.postMessage({
                        type: 'AdminPlusEasyLoginSession',
                        payload: data
                    }, '*');
                }
                
                // Schließe Verbindung nach erfolgreicher Anmeldung
                setTimeout(() => {
                    closeEasyLoginConnection();
                }, 1000);
                return;
            }
            
            // Fall 2: 2FA erforderlich (kein 2FA-Schlüssel in PWA)
            if (data.missing2fa) {
                log('2FA erforderlich - zeige 2FA Dialog und warte parallel auf PWA-Eingabe');
                pending2FAData = data;
                waiting2FAFromPWA = true;
                showEasyLogin2FAModal();
                updateEasyLoginStatus('2FA-Code erforderlich (AdminPlus oder PWA)', 'warning');
                return;
            }
            
            // Fall 3: Login fehlgeschlagen (ohne 2FA)
            updateEasyLoginStatus('Login fehlgeschlagen', 'danger');
            showNotification('Easy Login fehlgeschlagen');
            hideEasyLogin2FAModal();
            pending2FAData = null;
            waiting2FAFromPWA = false;
        }
    }

    // Auto-Refresh-Funktionen für Easy Login
    function startEasyLoginAutoRefresh() {
        // Stoppe zuerst alle bestehenden Intervalle
        stopEasyLoginAutoRefresh();

        // Prüfe Bedingungen: Sidebar sichtbar UND nicht angemeldet
        if (!sidebarVisible || authState?.loggedIn) {
            return;
        }

        // Starte neues Intervall: alle 45 Sekunden
        easyLoginRefreshInterval = setInterval(() => {
            // Nur refreshen wenn Sidebar sichtbar, nicht angemeldet UND keine Verbindung besteht
            if (sidebarVisible && !authState?.loggedIn && !isConnected()) {
                console.log('Auto-Refresh: Generiere neue Peer-ID');
                initEasyLoginPeer(true);
            } else if (authState?.loggedIn) {
                stopEasyLoginAutoRefresh();
            }
            // Bei bestehender Verbindung: Intervall läuft weiter, aber refresht nicht
        }, 45000); // 45 Sekunden

        console.log('Easy Login Auto-Refresh gestartet (45s Intervall, 15s Overlap)');
    }

    function stopEasyLoginAutoRefresh() {
        if (easyLoginRefreshInterval) {
            clearInterval(easyLoginRefreshInterval);
            easyLoginRefreshInterval = null;
            console.log('Easy Login Auto-Refresh gestoppt');
        }
    }

    function handleVisibilityChange() {
        sidebarVisible = !document.hidden;
        console.log('Sidebar Sichtbarkeit:', sidebarVisible ? 'sichtbar' : 'versteckt');

        if (sidebarVisible && !authState?.loggedIn) {
            // Sidebar wurde sichtbar und nicht angemeldet -> Auto-Refresh starten
            startEasyLoginAutoRefresh();
        } else {
            // Sidebar versteckt oder angemeldet -> Auto-Refresh stoppen
            stopEasyLoginAutoRefresh();
        }
    }

    // ==================== Adressen-Funktionalität ====================

    function setupAddressHandlers() {
        // Suche mit Clear-Button
        const searchInput = document.getElementById('address-search');
        const clearSearchBtn = document.getElementById('clear-search');
        
        searchInput?.addEventListener('input', (e) => {
            // Clear-Button anzeigen/verstecken
            if (clearSearchBtn) {
                clearSearchBtn.classList.toggle('hidden', !e.target.value);
            }
            debounce(applyFilters, 300)();
        });

        clearSearchBtn?.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                clearSearchBtn.classList.add('hidden');
                applyFilters();
            }
        });

        // Filter Toggle mit Text-Änderung
        document.getElementById('toggle-filters')?.addEventListener('click', () => {
            const panel = document.getElementById('filter-panel');
            const toggleText = document.getElementById('filter-toggle-text');
            if (panel) {
                const isHidden = panel.classList.toggle('hidden');
                if (toggleText) {
                    toggleText.textContent = isHidden ? 'Filter anzeigen' : 'Filter verbergen';
                }
            }
            updateActiveFiltersCount();
        });

        // Filter Buttons
        document.getElementById('apply-filters')?.addEventListener('click', applyFilters);
        document.getElementById('reset-filters')?.addEventListener('click', resetFilters);

        // Filter Änderungen
        document.getElementById('sort-field')?.addEventListener('change', applyFilters);
        document.getElementById('sort-order')?.addEventListener('change', applyFilters);
        document.getElementById('filter-active-members')?.addEventListener('change', applyFilters);
        document.getElementById('birthday-date')?.addEventListener('change', applyFilters);
        document.getElementById('birthday-tolerance')?.addEventListener('change', applyFilters);
        document.getElementById('jubilee-month')?.addEventListener('change', applyFilters);
        document.getElementById('jubilee-years')?.addEventListener('input', debounce(applyFilters, 500));

        // Auswahl
        document.getElementById('select-all')?.addEventListener('click', selectAll);
        document.getElementById('deselect-all')?.addEventListener('click', deselectAll);

        // Pagination
        document.getElementById('page-size')?.addEventListener('change', (e) => {
            pageSize = e.target.value === 'all' ? Infinity : parseInt(e.target.value);
            currentPage = 1;
            renderAddressList();
        });

        document.getElementById('prev-page')?.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderAddressList();
            }
        });

        document.getElementById('next-page')?.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredUsers.length / pageSize);
            if (currentPage < totalPages) {
                currentPage++;
                renderAddressList();
            }
        });

        // Einstellungen
        document.getElementById('settings-btn')?.addEventListener('click', openSettings);
        document.getElementById('close-settings')?.addEventListener('click', closeSettings);
        document.getElementById('cancel-settings')?.addEventListener('click', closeSettings);
        document.getElementById('save-settings')?.addEventListener('click', saveSettings);

        // Drucken
        document.getElementById('print-addresses')?.addEventListener('click', printAddresses);
    }

    async function loadUsers() {
        if (!authState?.loggedIn) return;

        const listEl = document.getElementById('address-list');
        if (!listEl) return;

        setAddressListMessage('loading-spinner', 'Lade Adressen...');

        try {
            const baseUrl = authState.instance?.hostName ? `https://${authState.instance.hostName}` : 'https://tkh.iw-erp.de';
            const sessionId = await getSessionId();

            // URL mit Parametern aufbauen
            const params = buildApiParams();
            const url = `${baseUrl}/api/crm/crmpeople?${params.toString()}`;
            const shortInfoParams = new URLSearchParams(params);
            shortInfoParams.set('className', 'global_person');
            shortInfoParams.set('addon', 'list');
            const shortInfoUrl = `${baseUrl}/api/dw/short_information?${shortInfoParams.toString()}`;

            const [response, shortInfoResponse] = await Promise.all([
                fetch(url, {
                    headers: {
                        'x-session-token': sessionId
                    }
                }),
                fetch(shortInfoUrl, {
                    headers: {
                        'x-session-token': sessionId
                    }
                })
            ]);

            if (!response.ok) {
                throw new Error('Fehler beim Laden der Benutzer');
            }

            const data = await response.json();
            if (shortInfoResponse.ok) {
                const infoData = await shortInfoResponse.json();
                const peopleInfo = Array.isArray(infoData)
                    ? infoData.find(item => item?.text_identifier === 'PEOPLE')
                    : null;
                const value = peopleInfo?.value;
                const parsedValue = typeof value === 'number' ? value : parseInt(value, 10);
                if (Number.isFinite(parsedValue)) {
                    totalUsersCount = parsedValue;
                }
            }
            // API gibt direkt crm_people zurück
            allUsers = data.map(person => ({
                id: person.id,
                name: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                profile_picture_url: person.profile_picture_url,
                crm_person: person
            }));
            
            filteredUsers = [...allUsers];
            currentPage = 1;
            renderAddressList();
        } catch (error) {
            console.error('Fehler beim Laden:', error);
            totalUsersCount = 0;
            setAddressListMessage('error-message', 'Fehler beim Laden der Adressen');
        }
    }

    function buildApiParams() {
        const params = new URLSearchParams();
        
        // Sortierung
        const sortField = document.getElementById('sort-field')?.value || 'firstName';
        const sortOrder = document.getElementById('sort-order')?.value || 'ASC';
        params.append('orderFieldName', sortField);
        params.append('orderFieldSort', sortOrder);
        
        // Nur Mitglieder (Standard)
        const activeOnly = document.getElementById('filter-active-members')?.checked;
        if (activeOnly !== false) {
            params.append('bitmaskLogBookContentTypeIN', 'LOG_CONTENT_TYPE_MEMBER');
        }
        
        // Suche
        const searchTerm = document.getElementById('address-search')?.value?.trim();
        if (searchTerm) {
            params.append('searchString', searchTerm);
        }
        
        // Geburtstag Filter
        const birthdayDate = document.getElementById('birthday-date')?.value;
        const birthdayTolerance = document.getElementById('birthday-tolerance')?.value || '7';
        if (birthdayDate) {
            params.append('birthdayMonthDay', birthdayDate);
            params.append('birthdayTolerance', birthdayTolerance);
        }
        
        // Jubiläum Filter
        const jubileeMonth = document.getElementById('jubilee-month')?.value;
        const jubileeYears = document.getElementById('jubilee-years')?.value?.trim();
        if (jubileeMonth && jubileeYears) {
            // Input type="month" gibt YYYY-MM zurück, API braucht YYYY-MM-01
            // Stelle sicher, dass Monat zweistellig ist
            const [year, month] = jubileeMonth.split('-');
            const jubileeDate = `${year}-${month.padStart(2, '0')}-01`;
            params.append('membershipStartMonthDay', jubileeDate);
            params.append('membershipLength', jubileeYears);
        }
        
        return params;
    }

    function getSessionId() {
        return new Promise((resolve) => {
            window.parent.postMessage({ type: 'AdminPlusRequestSessionId' }, '*');
            const handler = (event) => {
                if (event?.data?.type === 'AdminPlusSessionId') {
                    window.removeEventListener('message', handler);
                    resolve(event.data.sessionId);
                }
            };
            window.addEventListener('message', handler);
        });
    }

    function applyFilters() {
        // Filter werden jetzt serverseitig angewendet
        // Einfach neu laden
        updateActiveFiltersCount();
        loadUsers();
    }

    function updateActiveFiltersCount() {
        let count = 0;
        
        if (document.getElementById('address-search')?.value) count++;
        if (!document.getElementById('filter-active-members')?.checked) count++;
        if (document.getElementById('birthday-date')?.value) count++;
        if (document.getElementById('jubilee-month')?.value && document.getElementById('jubilee-years')?.value) count++;
        
        const sortField = document.getElementById('sort-field')?.value;
        const sortOrder = document.getElementById('sort-order')?.value;
        if (sortField !== 'firstName' || sortOrder !== 'ASC') count++;

        const badge = document.getElementById('active-filters-badge');
        if (badge) {
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
        }
    }

    function resetFilters() {
        const searchEl = document.getElementById('address-search');
        const sortFieldEl = document.getElementById('sort-field');
        const sortOrderEl = document.getElementById('sort-order');
        const activeMembersEl = document.getElementById('filter-active-members');
        const birthdayDateEl = document.getElementById('birthday-date');
        const birthdayToleranceEl = document.getElementById('birthday-tolerance');
        const jubileeYearsEl = document.getElementById('jubilee-years');
        const jubileeMonthEl = document.getElementById('jubilee-month');

        if (searchEl) searchEl.value = '';
        if (sortFieldEl) sortFieldEl.value = 'firstName';
        if (sortOrderEl) sortOrderEl.value = 'ASC';
        if (activeMembersEl) activeMembersEl.checked = true;
        if (birthdayDateEl) birthdayDateEl.value = '';
        if (birthdayToleranceEl) birthdayToleranceEl.value = '7';
        if (jubileeYearsEl) jubileeYearsEl.value = '';
        if (jubileeMonthEl) jubileeMonthEl.value = '';
        
        // Clear-Button verstecken
        document.getElementById('clear-search')?.classList.add('hidden');
        
        applyFilters();
    }

    function renderAddressList() {
        const listEl = document.getElementById('address-list');
        if (!listEl) return;

        const start = (currentPage - 1) * pageSize;
        const end = pageSize === Infinity ? filteredUsers.length : start + pageSize;
        const pageUsers = filteredUsers.slice(start, end);

        if (pageUsers.length === 0) {
            setAddressListMessage('empty-message', 'Keine Adressen gefunden');
            updatePagination();
            return;
        }

        const fragment = document.createDocumentFragment();
        pageUsers.forEach((user) => {
            fragment.appendChild(createUserCardElement(user));
        });
        listEl.replaceChildren(fragment);

        // Event Listener für Avatare (Fallback bei Fehler)
        listEl.querySelectorAll('.user-avatar[data-fallback-avatar]').forEach(img => {
            img.addEventListener('error', function() {
                this.src = 'https://secure.gravatar.com/avatar/?s=80&d=mm&r=g';
                this.removeAttribute('data-fallback-avatar'); // Verhindere Endlosschleife
            });
        });

        // Event Listener für Auswahl
        listEl.querySelectorAll('.user-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Verhindere Auswahl wenn Checkbox geklickt wurde
                if (e.target.type === 'checkbox') {
                    e.stopPropagation();
                    toggleUserSelection(card.dataset.userId);
                } else {
                    toggleUserSelection(card.dataset.userId);
                }
            });
        });

        // Checkbox Event Handler
        listEl.querySelectorAll('[data-user-checkbox]').forEach(checkbox => {
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        updatePagination();
        updateSelectionCount();
    }

    function createUserCardElement(user) {
        const person = user.crm_person || user;
        const isSelected = selectedUsers.has(user.id);
        const isActive = isActiveMember(user);
        const avatarUrl = getSafeAvatarUrl(
            user.profile_picture_url || person.profile_picture_url
        );

        const card = document.createElement('div');
        card.className = 'user-card';
        if (isSelected) card.classList.add('selected');
        if (!isActive) card.classList.add('inactive');
        card.dataset.userId = String(user.id);

        const checkboxWrap = document.createElement('div');
        checkboxWrap.className = 'user-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isSelected;
        checkbox.dataset.userCheckbox = String(user.id);
        checkboxWrap.appendChild(checkbox);

        const avatar = document.createElement('img');
        avatar.className = 'user-avatar';
        avatar.src = avatarUrl;
        avatar.alt = user.name || '';
        avatar.dataset.fallbackAvatar = 'true';

        const info = document.createElement('div');
        info.className = 'user-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'user-name';
        nameEl.textContent =
            user.name ||
            `${person.first_name || ''} ${person.last_name || ''}`.trim() ||
            'Unbekannt';

        const numberEl = document.createElement('div');
        numberEl.className = 'user-number';
        numberEl.textContent = person.number_string || '';

        const metaEl = document.createElement('div');
        metaEl.className = 'user-meta';
        const birthdayEl = document.createElement('span');
        birthdayEl.textContent = `🎂 ${formatDate(person.birthday)}`;
        const memberEl = document.createElement('span');
        memberEl.textContent = `📅 ${formatDate(person.start_time)} ${
            person.end_time ? `- ${formatDate(person.end_time)}` : '(aktiv)'
        }`;
        metaEl.appendChild(birthdayEl);
        metaEl.appendChild(memberEl);

        const addressEl = document.createElement('div');
        addressEl.className = 'user-address';
        addressEl.textContent = formatAddress(person);

        info.appendChild(nameEl);
        info.appendChild(numberEl);
        info.appendChild(metaEl);
        info.appendChild(addressEl);

        card.appendChild(checkboxWrap);
        card.appendChild(avatar);
        card.appendChild(info);

        return card;
    }

    function toggleUserSelection(userId) {
        userId = parseInt(userId);
        if (selectedUsers.has(userId)) {
            selectedUsers.delete(userId);
        } else {
            selectedUsers.add(userId);
        }
        renderAddressList();
        updatePrintButton();
    }

    function selectAll() {
        filteredUsers.forEach(user => selectedUsers.add(user.id));
        renderAddressList();
        updatePrintButton();
    }

    function deselectAll() {
        selectedUsers.clear();
        renderAddressList();
        updatePrintButton();
    }

    function updatePrintButton() {
        const printBtn = document.getElementById('print-addresses');
        if (printBtn) {
            printBtn.disabled = selectedUsers.size === 0;
        }
    }

    function updateSelectionCount() {
        // Statistiken aktualisieren
        const totalEl = document.getElementById('total-users');
        const filteredEl = document.getElementById('filtered-users');
        const selectedEl = document.getElementById('selected-users-count');
        const printCountEl = document.getElementById('print-count');

        if (totalEl) totalEl.textContent = totalUsersCount;
        if (filteredEl) filteredEl.textContent = allUsers.length;
        if (selectedEl) selectedEl.textContent = selectedUsers.size;
        if (printCountEl) printCountEl.textContent = selectedUsers.size;
    }

    function updatePagination() {
        const totalPages = Math.ceil(filteredUsers.length / pageSize);
        const pageInfo = document.getElementById('page-info');
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');

        if (pageInfo) {
            pageInfo.textContent = pageSize === Infinity ? 
                `${filteredUsers.length} Einträge` :
                `Seite ${currentPage} von ${totalPages || 1} (${filteredUsers.length} Einträge)`;
        }

        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages || pageSize === Infinity;
    }

    // Helper Functions
    function isActiveMember(user) {
        const person = user.crm_person || user;
        const start = person.start_time;
        const end = person.end_time;
        if (!start) return false;
        
        const now = new Date();
        const startDate = new Date(start);
        
        if (startDate > now) return false;
        if (!end) return true;
        
        const endDate = new Date(end);
        return endDate >= now;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('de-DE');
    }

    function formatAddress(person) {
        if (!person) return '';
        
        const parts = [];
        if (person.address_street_level) parts.push(person.address_street_level);
        else if (person.address_street && person.address_house_number) {
            parts.push(`${person.address_street} ${person.address_house_number}`);
        }
        
        if (person.address_zip && person.address_city) {
            parts.push(`${person.address_zip} ${person.address_city}`);
        }
        
        return parts.join(', ');
    }

    function formatAddressForLetter(person) {
        if (!person) return '';
        
        const lines = [];
        
        // Name
        const salutation = person.special_salutation || '';
        const name = `${person.first_name || ''} ${person.last_name || ''}`.trim();
        if (salutation && name) {
            lines.push(`${salutation} ${name}`);
        } else if (name) {
            lines.push(name);
        }
        
        // Straße
        if (person.address_street_level) {
            lines.push(person.address_street_level);
        } else if (person.address_street && person.address_house_number) {
            lines.push(`${person.address_street} ${person.address_house_number}`);
        }
        
        // PLZ Ort
        if (person.address_zip && person.address_city) {
            lines.push(`${person.address_zip} ${person.address_city}`);
        }
        
        return lines.join('\n');
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Einstellungen
    function loadSettings() {
        const saved = localStorage.getItem('adminplus-settings');
        if (saved) {
            try {
                settings = JSON.parse(saved);
            } catch (e) {}
        }
    }

    function saveSettingsToStorage() {
        localStorage.setItem('adminplus-settings', JSON.stringify(settings));
    }

    function openSettings() {
        const modal = document.getElementById('settings-modal');
        document.getElementById('show-cutlines').checked = settings.showCutlines;
        document.getElementById('sender-address').value = settings.senderAddress || '';
        modal?.classList.remove('hidden');
    }

    function closeSettings() {
        document.getElementById('settings-modal')?.classList.add('hidden');
    }

    function saveSettings() {
        settings.showCutlines = document.getElementById('show-cutlines').checked;
        settings.senderAddress = document.getElementById('sender-address').value;
        saveSettingsToStorage();
        closeSettings();
    }

    // Drucken
    function printAddresses() {
        if (selectedUsers.size === 0) return;

        const users = allUsers.filter(u => selectedUsers.has(u.id));
        const html = generatePrintHTML(users);
        const printBlob = new Blob([html], { type: 'text/html' });
        const printUrl = URL.createObjectURL(printBlob);
        const printWindow = window.open(printUrl, '_blank', 'noopener,noreferrer');

        if (!printWindow) {
            URL.revokeObjectURL(printUrl);
            showNotification('Pop-up blockiert: Bitte Pop-ups fuer diese Seite erlauben.');
            return;
        }

        printWindow.onload = () => {
            printWindow.print();
            setTimeout(() => URL.revokeObjectURL(printUrl), 1000);
        };
    }

    function generatePrintHTML(users) {
        const addressesPerPage = 3;
        const pages = [];
        
        for (let i = 0; i < users.length; i += addressesPerPage) {
            const pageUsers = users.slice(i, i + addressesPerPage);
            pages.push(generatePage(pageUsers));
        }

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Adressliste</title>
    <style>
        @page {
            size: A4;
            margin: 0;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: Arial, sans-serif;
            font-size: 10pt;
        }
        
        .page {
            width: 210mm;
            height: 297mm;
            position: relative;
            page-break-after: always;
        }
        
        .page:last-child {
            page-break-after: auto;
        }
        
        .address-section {
            width: 210mm;
            height: 99mm;
            position: relative;
            ${settings.showCutlines ? 'border-bottom: 1px dashed #999;' : ''}
        }
        
        .address-window {
            position: absolute;
            left: 20mm;
            bottom: 15mm;
            width: 70mm;
            height: 30mm;
        }
        
        .sender-line {
            font-size: 7pt;
            border-bottom: 1px solid #000;
            padding-bottom: 2px;
            margin-bottom: 3mm;
        }
        
        .recipient {
            font-size: 10pt;
            line-height: 1.3;
            white-space: pre-line;
        }
        
        @media print {
            .page {
                page-break-after: always;
            }
            .page:last-child {
                page-break-after: auto;
            }
        }
    </style>
</head>
<body>
    ${pages.join('')}
</body>
</html>
        `;
    }

    function generatePage(users) {
        const sections = [];
        
        for (let i = 0; i < 3; i++) {
            const user = users[i];
            const recipient = user ? formatAddressForLetter(user.crm_person) : '';
            const senderLine = settings.senderAddress
                ? `<div class="sender-line">${escapeHtml(settings.senderAddress).replace(/\n/g, ' · ')}</div>`
                : '';
            const recipientHtml = escapeHtml(recipient).replace(/\n/g, '<br>');
            
            sections.push(`
                <div class="address-section">
                    ${user ? `
                        <div class="address-window">
                            ${senderLine}
                            <div class="recipient">${recipientHtml}</div>
                        </div>
                    ` : ''}
                </div>
            `);
        }
        
        return `<div class="page">${sections.join('')}</div>`;
    }

    // ===== Easy Login Encryption Functions =====

    function setAddressListMessage(className, text) {
        const listEl = document.getElementById('address-list');
        if (!listEl) return;

        const message = document.createElement('div');
        message.className = className;
        message.textContent = text;
        listEl.replaceChildren(message);
    }

    function getSafeAvatarUrl(candidateUrl) {
        const fallback = 'https://secure.gravatar.com/avatar/?s=80&d=mm&r=g';
        if (!candidateUrl || typeof candidateUrl !== 'string') return fallback;

        try {
            const parsed = new URL(candidateUrl, window.location.href);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                return parsed.href;
            }
        } catch (error) {
            return fallback;
        }

        return fallback;
    }

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    
    // Lokale Encryption Utilities (ohne externe Abhängigkeiten)
    const LocalEncryption = (() => {
        async function generateKeyPair() {
            try {
                const keyPair = await crypto.subtle.generateKey(
                    {
                        name: 'RSA-OAEP',
                        modulusLength: 2048,
                        publicExponent: new Uint8Array([1, 0, 1]),
                        hash: 'SHA-256'
                    },
                    true,
                    ['encrypt', 'decrypt']
                );
                return keyPair;
            } catch (error) {
                console.error('Fehler beim Generieren des Key Paares:', error);
                return null;
            }
        }

        async function exportPublicKey(publicKey) {
            try {
                const jwk = await crypto.subtle.exportKey('jwk', publicKey);
                return JSON.stringify(jwk);
            } catch (error) {
                console.error('Fehler beim Exportieren des Public Keys:', error);
                return null;
            }
        }

        async function importPublicKey(jwkString) {
            try {
                const jwk = JSON.parse(jwkString);
                const publicKey = await crypto.subtle.importKey(
                    'jwk',
                    jwk,
                    {
                        name: 'RSA-OAEP',
                        hash: 'SHA-256'
                    },
                    true,
                    ['encrypt']
                );
                return publicKey;
            } catch (error) {
                console.error('Fehler beim Importieren des Public Keys:', error);
                return null;
            }
        }

        async function encryptObject(publicKey, obj) {
            try {
                // 1. Generiere einen zufälligen AES-Schlüssel
                const aesKey = await crypto.subtle.generateKey(
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                
                // 2. Generiere einen zufälligen IV für AES
                const iv = crypto.getRandomValues(new Uint8Array(12));
                
                // 3. Verschlüssele die Daten mit AES-GCM
                const jsonString = JSON.stringify(obj);
                const encoder = new TextEncoder();
                const data = encoder.encode(jsonString);
                const encryptedData = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv },
                    aesKey,
                    data
                );
                
                // 4. Exportiere den AES-Schlüssel als Raw-Format
                const aesKeyRaw = await crypto.subtle.exportKey('raw', aesKey);
                
                // 5. Verschlüssele den AES-Schlüssel mit RSA
                const encryptedAesKey = await crypto.subtle.encrypt(
                    'RSA-OAEP',
                    publicKey,
                    aesKeyRaw
                );
                
                // 6. Kombiniere alles: verschlüsselter AES-Schlüssel + IV + verschlüsselte Daten
                const result = {
                    encryptedKey: btoa(String.fromCharCode(...new Uint8Array(encryptedAesKey))),
                    iv: btoa(String.fromCharCode(...iv)),
                    data: btoa(String.fromCharCode(...new Uint8Array(encryptedData)))
                };
                
                return JSON.stringify(result);
            } catch (error) {
                console.error('Fehler beim Verschlüsseln:', error);
                return null;
            }
        }

        async function decryptObject(privateKey, encryptedBase64) {
            try {
                // Parse das verschlüsselte Objekt
                let encryptedObj;
                try {
                    encryptedObj = JSON.parse(encryptedBase64);
                } catch {
                    // Fallback für altes Format (direkt RSA-verschlüsselt)
                    try {
                        const encryptedData = Uint8Array.from(
                            atob(encryptedBase64),
                            c => c.charCodeAt(0)
                        );
                        const decryptedBuffer = await crypto.subtle.decrypt(
                            'RSA-OAEP',
                            privateKey,
                            encryptedData
                        );
                        const decoder = new TextDecoder();
                        const decrypted = decoder.decode(decryptedBuffer);
                        return JSON.parse(decrypted);
                    } catch (legacyError) {
                        console.error('Fehler beim Entschlüsseln (Legacy-Format):', legacyError);
                        return null;
                    }
                }
                
                // Neues Hybrid-Format
                // 1. Konvertiere die Base64-Strings zurück zu Uint8Arrays
                const encryptedKey = Uint8Array.from(
                    atob(encryptedObj.encryptedKey),
                    c => c.charCodeAt(0)
                );
                const iv = Uint8Array.from(
                    atob(encryptedObj.iv),
                    c => c.charCodeAt(0)
                );
                const encryptedData = Uint8Array.from(
                    atob(encryptedObj.data),
                    c => c.charCodeAt(0)
                );
                
                // 2. Entschlüssele den AES-Schlüssel mit RSA
                const aesKeyRaw = await crypto.subtle.decrypt(
                    'RSA-OAEP',
                    privateKey,
                    encryptedKey
                );
                
                // 3. Importiere den AES-Schlüssel
                const aesKey = await crypto.subtle.importKey(
                    'raw',
                    aesKeyRaw,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['decrypt']
                );
                
                // 4. Entschlüssele die Daten mit AES-GCM
                const decryptedBuffer = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: iv },
                    aesKey,
                    encryptedData
                );
                
                const decoder = new TextDecoder();
                const decrypted = decoder.decode(decryptedBuffer);
                return JSON.parse(decrypted);
            } catch (error) {
                console.error('Fehler beim Entschlüsseln:', error);
                return null;
            }
        }

        return {
            generateKeyPair,
            exportPublicKey,
            importPublicKey,
            encryptObject,
            decryptObject
        };
    })();
    
    async function initializeConnectionEncryption(conn) {
        try {
            // Generiere neues Key Paar für diese Verbindung
            easyLoginKeyPair = await LocalEncryption.generateKeyPair();
            if (!easyLoginKeyPair) {
                log('Fehler: Key Paar konnte nicht generiert werden');
                return;
            }
            log('Neues Key Paar generiert');
            
            // Exportiere Public Key und sende Hello mit Public Key
            const publicKeyString = await LocalEncryption.exportPublicKey(easyLoginKeyPair.publicKey);
            conn.send({
                type: 'EasyLoginHello',
                client: 'AdminPlus',
                publicKey: publicKeyString
            });
            log('Hello mit Public Key an PWA gesendet');
        } catch (error) {
            log('Fehler bei Initialisierung der Verschlüsselung:', error);
        }
    }

    async function handleEasyLoginDataEncrypted(data) {
        if (!data) return;
        
        // Wenn PWA-Public Key mit Hello kommt, speichere ihn
        if (data.type === 'EasyLoginHello' && data.publicKey) {
            remotePWAPublicKey = await LocalEncryption.importPublicKey(data.publicKey);
            log('PWA Public Key empfangen und gespeichert');
            return;
        }
        
        // Wenn Nachricht verschlüsselt ist, entschlüssele sie
        if (data.encrypted && data.encryptedData && easyLoginKeyPair?.privateKey) {
            const decrypted = await LocalEncryption.decryptObject(
                easyLoginKeyPair.privateKey,
                data.encryptedData
            );
            
            if (decrypted) {
                log('Nachricht entschlüsselt:', decrypted?.type);
                // Verarbeite die entschlüsselte Nachricht
                handleEasyLoginData(decrypted);
                return;
            } else {
                log('Fehler beim Entschlüsseln der Nachricht');
                return;
            }
        }
        
        // Unverschlüsselte Nachrichten (für Kompatibilität)
        handleEasyLoginData(data);
    }

    /**
     * Sendet verschlüsselte Nachricht an PWA über PeerJS
     * Erfordert Nutzerbestätigung, wenn Verschlüsselung fehlschlägt
     */
    async function sendEncryptedMessageToConnection(conn, message) {
        if (!conn?.open) {
            log('Fehler: Keine offene Verbindung');
            return;
        }
        
        if (!remotePWAPublicKey) {
            log('Fehler: PWA Public Key nicht verfügbar - Verschlüsselung unmöglich');
            // Frage den Nutzer, ob er ohne Verschlüsselung senden möchte
            const allowUnencrypted = confirm(
                'Der öffentliche Schlüssel der PWA ist nicht verfügbar. Möchten Sie die Nachricht unverschlüsselt senden? Warnung: Dies ist unsicher!'
            );
            if (allowUnencrypted) {
                conn.send(message);
                log('Nachricht unverschlüsselt gesendet (mit Benutzerbestätigung)');
            } else {
                log('Benutzer hat unverschlüsseltem Senden nicht zugestimmt');
            }
            return;
        }
        
        try {
            const encryptedData = await LocalEncryption.encryptObject(
                remotePWAPublicKey,
                message
            );
            
            if (encryptedData) {
                conn.send({
                    encrypted: true,
                    encryptedData: encryptedData
                });
                log('Verschlüsselte Nachricht gesendet:', message?.type);
            } else {
                log('Fehler: Verschlüsselung ergab keine Daten');
                // Frage den Nutzer, ob er ohne Verschlüsselung senden möchte
                const allowUnencrypted = confirm(
                    'Die Verschlüsselung hat fehlgeschlagen. Möchten Sie die Nachricht unverschlüsselt senden? Warnung: Dies ist unsicher!'
                );
                if (allowUnencrypted) {
                    conn.send(message);
                    log('Nachricht unverschlüsselt gesendet (mit Benutzerbestätigung)');
                } else {
                    log('Benutzer hat unverschlüsseltem Senden nicht zugestimmt');
                }
            }
        } catch (error) {
            log('Fehler beim Senden verschlüsselter Nachricht:', error);
            // Frage den Nutzer, ob er ohne Verschlüsselung senden möchte
            const allowUnencrypted = confirm(
                'Ein Fehler bei der Verschlüsselung ist aufgetreten. Möchten Sie die Nachricht unverschlüsselt senden? Warnung: Dies ist unsicher!'
            );
            if (allowUnencrypted) {
                conn.send(message);
                log('Nachricht unverschlüsselt gesendet (mit Benutzerbestätigung)');
            } else {
                log('Benutzer hat unverschlüsseltem Senden nicht zugestimmt');
            }
        }
    }

    /**
     * Schließt die Verbindung sauber
     */
    function closeEasyLoginConnection() {
        if (easyLoginConnection?.open) {
            try {
                easyLoginConnection.close();
            } catch {}
        }
        easyLoginConnection = null;
        easyLoginKeyPair = null;
        remotePWAPublicKey = null;
    }

    // CSS Animationen hinzufügen
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    // ===== Easy Login 2FA Functions =====
    function showEasyLogin2FAModal() {
        const modal = document.getElementById('easy-login-2fa-modal');
        const input = document.getElementById('easy-login-2fa-input');
        const status = document.getElementById('easy-login-2fa-status');
        
        if (modal) {
            modal.classList.remove('hidden');
            if (input) {
                input.value = '';
                input.focus();
            }
            if (status) {
                status.classList.add('hidden');
                status.textContent = '';
            }
        }
    }

    function hideEasyLogin2FAModal() {
        const modal = document.getElementById('easy-login-2fa-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        pending2FAData = null;
        waiting2FAFromPWA = false;
    }

    async function handleEasyLogin2FASubmit() {
        const input = document.getElementById('easy-login-2fa-input');
        const status = document.getElementById('easy-login-2fa-status');
        const code = input?.value?.trim();

        if (!code || code.length !== 6) {
            showEasyLogin2FAStatus('Bitte geben Sie einen 6-stelligen Code ein', 'danger');
            return;
        }

        if (!pending2FAData || !authState?.instance) {
            showEasyLogin2FAStatus('Keine ausstehende 2FA-Anfrage', 'danger');
            return;
        }

        log('Verifiziere 2FA mit Code:', code);
        showEasyLogin2FAStatus('Verifiziere...', 'warning');

        try {
            const hostName = authState.instance.hostName || authState.instance.host_name || '';
            const sessionToken = pending2FAData.session?.sessionid || '';
            
            if (!sessionToken) {
                log('Fehler: Keine sessionid in pending2FAData gefunden');
                showEasyLogin2FAStatus('2FA Fehler: Keine Session', 'danger');
                return;
            }

            const url = `https://${hostName}/api/session/verify2fa/all/${code}`;
            log('2FA Verify URL:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'x-session-token': sessionToken
                }
            });

            log('2FA Response Status:', response.status);

            if (response.status === 401) {
                log('2FA Failed: 401 Unauthorized');
                showEasyLogin2FAStatus('2FA Code ungültig', 'danger');
                return;
            }

            const verifyData = await response.json().catch(() => null);
            log('2FA Verify Data:', verifyData);

            if (response.ok) {
                log('2FA erfolgreich - sende zum Parent und PWA');
                showEasyLogin2FAStatus('2FA erfolgreich!', 'success');
                
                // Erfolgreiche 2FA-Antwort an PWA senden (verschlüsselt)
                if (easyLoginConnection?.open) {
                    await sendEncryptedMessageToConnection(easyLoginConnection, {
                        type: 'EasyLoginResponse',
                        success: true,
                        session: verifyData || pending2FAData.session,
                        host: authState.instance.hostName || authState.instance.host_name || '',
                        ref: pending2FAData.ref
                    });
                }
                
                // Erfolgreiche 2FA-Antwort an Parent senden
                if (window.parent) {
                    window.parent.postMessage({
                        type: 'AdminPlusEasyLoginSession',
                        payload: {
                            type: 'EasyLoginResponse',
                            success: true,
                            session: verifyData || pending2FAData.session,
                            host: authState.instance.hostName || authState.instance.host_name || '',
                            ref: pending2FAData.ref
                        }
                    }, '*');
                }

                updateEasyLoginStatus('Login erfolgreich', 'success');
                showNotification('Easy Login erfolgreich');
                
                // Schließe Modal und Verbindung nach kurzer Verzögerung
                setTimeout(() => {
                    hideEasyLogin2FAModal();
                    closeEasyLoginConnection();
                }, 1000);
            } else {
                log('2FA Verifizierung fehlgeschlagen');
                showEasyLogin2FAStatus('2FA Verifizierung fehlgeschlagen', 'danger');
            }
        } catch (error) {
            log('2FA Fehler:', error);
            showEasyLogin2FAStatus('2FA Fehler aufgetreten', 'danger');
        }
    }

    function showEasyLogin2FAStatus(message, type) {
        const status = document.getElementById('easy-login-2fa-status');
        if (!status) return;

        status.textContent = message;
        status.classList.remove('hidden', 'success', 'warning', 'danger');
        if (type) {
            status.classList.add(type);
        }
        
        // Styles basierend auf dem Type
        if (type === 'success') {
            status.style.backgroundColor = '#d4edda';
            status.style.color = '#155724';
        } else if (type === 'warning') {
            status.style.backgroundColor = '#fff3cd';
            status.style.color = '#856404';
        } else if (type === 'danger') {
            status.style.backgroundColor = '#f8d7da';
            status.style.color = '#721c24';
        }
    }
})();
