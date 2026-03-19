(function () {
    'use strict';

    let sidebarIframe = null;
    let instanceInfo = null;

    // Warten bis Flutter geladen ist
    const waitForFlutter = setInterval(() => {
        const flutterView = document.querySelector("flutter-view");
        if (!flutterView) return;

        clearInterval(waitForFlutter);
        console.log("AdminPlus: Flutter-App erkannt");
        
        // Kurze Verzögerung für vollständiges Flutter-Rendering
        setTimeout(() => {
            injectFloatingButton();
        }, 1000);
    }, 500);

    window.addEventListener('message', (event) => {
        if (!sidebarIframe || event.source !== sidebarIframe.contentWindow) return;
        
        if (event?.data?.type === 'AdminPlusRequestAuth') {
            sendAuthStatusToSidebar();
        } else if (event?.data?.type === 'AdminPlusRequestSessionId') {
            sendSessionIdToSidebar();
        } else if (event?.data?.type === 'AdminPlusEasyLoginSession') {
            handleEasyLoginSession(event.data.payload);
        }
    });

    function getInstanceInfo() {
        if (instanceInfo) return instanceInfo;

        // Suche nach flutter.iw-s-i-* Keys im LocalStorage
        const instanceKey = Object.keys(localStorage).find(k => k.startsWith('flutter.iw-s-i-'));
        if (!instanceKey) return null;

        let raw = localStorage.getItem(instanceKey);
        if (!raw) return null;

        // Doppelt geparst (wie Session-Daten)
        let value = raw;
        for (let i = 0; i < 2; i++) {
            if (typeof value === 'string') {
                try {
                    value = JSON.parse(value);
                } catch {
                    break;
                }
            }
        }

        instanceInfo = typeof value === 'object' && value !== null ? value : null;
        return instanceInfo;
    }

    function getLastRef() {
        const raw = localStorage.getItem('flutter.iw-s-last-ref');
        if (!raw) return '';

        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'string' ? parsed : raw;
        } catch {
            return raw;
        }
    }

    function getBaseUrl() {
        const info = getInstanceInfo();
        const hostName = info?.host_name;
        if (!hostName) {
            console.warn('AdminPlus: Keine host_name in Instanz-Info gefunden, nutze Fallback');
            return 'https://tkh.iw-erp.de';
        }
        return `https://${hostName}`;
    }

    function getSessionFromLocalStorage() {
        const baseUrl = getBaseUrl();
        const hostPart = baseUrl.replace(/https?:\/\//, '').replace(/\./g, '_').replace(/:/g, '_');
        const SESSION_STORAGE_PREFIX = `flutter.${hostPart}_iw-session`;

        let raw = localStorage.getItem(SESSION_STORAGE_PREFIX);
        if (!raw) {
            const key = Object.keys(localStorage).find(k => k.includes('iw-session'));
            if (key) {
                raw = localStorage.getItem(key);
            }
        }

        if (!raw) return null;

        let value = raw;
        for (let i = 0; i < 2; i++) {
            if (typeof value === 'string') {
                try {
                    value = JSON.parse(value);
                } catch {
                    break;
                }
            }
        }

        return typeof value === 'object' && value !== null ? value : null;
    }

    async function validateSession(sessionId) {
        try {
            const baseUrl = getBaseUrl();
            const sessionValidateUrl = `${baseUrl}/api/sessions`;

            const response = await fetch(sessionValidateUrl, {
                method: 'GET',
                headers: {
                    'x-session-token': sessionId
                }
            });

            if (response.status !== 200) {
                return { loggedIn: false };
            }

            const data = await response.json();
            if (data?.valid === false) {
                return { loggedIn: false };
            }

            return { loggedIn: true, user: data?.user || null };
        } catch {
            return { loggedIn: false };
        }
    }

    function buildUserName(user) {
        const firstName = user?.crm_person?.first_name || user?.first_name || '';
        const lastName = user?.crm_person?.last_name || user?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim();

        if (fullName) {
            return { firstName, lastName, fullName };
        }

        const fallbackName = user?.name || user?.username || '';
        return { firstName: '', lastName: '', fullName: fallbackName };
    }

    async function getAuthStatus() {
        const session = getSessionFromLocalStorage();
        if (!session?.sessionid) {
            const info = getInstanceInfo();
            return {
                loggedIn: false,
                instance: {
                    name: info?.public_listing_name || '',
                    image: info?.public_listing_image || '',
                    hostName: info?.host_name || '',
                    lastRef: getLastRef() || info?.host_name || ''
                }
            };
        }

        const validation = await validateSession(session.sessionid);
        if (!validation.loggedIn) {
            return { loggedIn: false };
        }

        const userSource = validation.user || session.user || null;
        const nameData = buildUserName(userSource);

        const info = getInstanceInfo();

        return {
            loggedIn: true,
            user: {
                ...nameData,
                name: nameData.fullName || userSource?.name || '',
                profilePicture: userSource?.profile_picture_url || userSource?.crm_person?.profile_picture_url || ''
            },
            instance: {
                name: info?.public_listing_name || '',
                image: info?.public_listing_image || '',
                hostName: info?.host_name || '',
                lastRef: getLastRef() || info?.host_name || ''
            }
        };
    }

    async function handleEasyLoginSession(payload) {
        if (!payload) return;

        const currentAuth = await getAuthStatus();
        if (currentAuth?.loggedIn) {
            console.log('EasyLogin: Bereits angemeldet, überspringe EasyLogin.');
            return;
        }

        if (payload?.success === false) {
            console.warn('EasyLogin: Login fehlgeschlagen');
            return;
        }

        const sessionData = payload?.session || payload?.data || payload?.response || payload || null;
        const keyFixed = 'flutter.tkh_iw_erp_de_iw-session';

        if (sessionData) {
            // Double-stringify wie Flutter: JSON-Objekt → String → nochmal als String
            const serialized = JSON.stringify(JSON.stringify(sessionData));
            localStorage.setItem(keyFixed, serialized);
        }

        if (payload?.ref) {
            localStorage.setItem('flutter.iw-s-last-ref', JSON.stringify(payload.ref));
        } else if (hostName) {
            localStorage.setItem('flutter.iw-s-last-ref', JSON.stringify(hostName));
        }

        const redirectHost = payload?.ref || getLastRef() || hostName;
        if (redirectHost) {
            const redirectUrl = `https://${redirectHost}/#/home`;
            
            // Öffne die URL in einem neuen Tab und schließe dann diesen Tab
            const newTab = window.open(redirectUrl, '_blank');
            
            // Stelle sicher, dass der neue Tab erfolgreich geöffnet wurde
            if (newTab) {
                // Sende Nachricht an Background Script um diesen Tab zu schließen
                chrome.runtime.sendMessage({ type: 'closeTab' });
            } else {
                // Fallback: Wenn neuer Tab blockiert wird, nutze normales Redirect
                console.warn('AdminPlus: Neuer Tab konnte nicht geöffnet werden, nutze Fallback');
                window.location.href = redirectUrl;
                location.reload();
            }
        }
    }

    async function sendAuthStatusToSidebar() {
        if (!sidebarIframe?.contentWindow) return;

        const status = await getAuthStatus();
        const targetOrigin = new URL(browser.runtime.getURL('sidebar.html')).origin;
        sidebarIframe.contentWindow.postMessage({
            type: 'AdminPlusAuth',
            payload: status
        }, targetOrigin);
    }

    async function sendSessionIdToSidebar() {
        if (!sidebarIframe?.contentWindow) return;

        const session = getSessionFromLocalStorage();
        const sessionId = session?.sessionid || '';
        
        const targetOrigin = new URL(browser.runtime.getURL('sidebar.html')).origin;
        sidebarIframe.contentWindow.postMessage({
            type: 'AdminPlusSessionId',
            sessionId: sessionId
        }, targetOrigin);
    }

    function injectFloatingButton() {
        // Prüfen ob Button bereits existiert
        if (document.getElementById("tkh-plus-fab")) return;

        // Floating Action Button erstellen (Material Design Pattern)
        const fab = document.createElement("div");
        fab.id = "tkh-plus-fab";
        fab.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
        `;
        fab.title = "AdminPlus öffnen";

        // FAB Styling - rechts unten positioniert
        fab.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 6px 20px rgba(0,0,0,0.19);
            z-index: 10000;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            font-size: 24px;
            user-select: none;
        `;

        // Hover & Active Effekte
        fab.addEventListener("mouseenter", () => {
            fab.style.transform = "scale(1.1)";
            fab.style.boxShadow = "0 6px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.24)";
        });

        fab.addEventListener("mouseleave", () => {
            fab.style.transform = "scale(1)";
            fab.style.boxShadow = "0 4px 8px rgba(0,0,0,0.3), 0 6px 20px rgba(0,0,0,0.19)";
        });

        fab.addEventListener("mousedown", () => {
            fab.style.transform = "scale(0.95)";
        });

        fab.addEventListener("mouseup", () => {
            fab.style.transform = "scale(1.1)";
        });

        fab.addEventListener("click", () => {
            toggleSidebar();
        });

        document.body.appendChild(fab);
        console.log("AdminPlus: Floating Action Button hinzugefügt");
    }

    function toggleSidebar() {
        let overlay = document.getElementById("tkh-plus-overlay");
        let sidebar = document.getElementById("tkh-plus-sidebar");
        
        if (sidebar) {
            // Schließen mit Animation
            sidebar.style.transform = "translateX(100%)";
            overlay.style.opacity = "0";
            
            setTimeout(() => {
                sidebar?.remove();
                overlay?.remove();
                sidebarIframe = null;
            }, 300);
            return;
        }

        // Overlay für Dimming erstellen
        overlay = document.createElement("div");
        overlay.id = "tkh-plus-overlay";
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9997;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        
        // Bei Overlay-Klick schließen
        overlay.addEventListener("click", () => toggleSidebar());

        // Sidebar Container erstellen
        const sidebarContainer = document.createElement("div");
        sidebarContainer.id = "tkh-plus-sidebar";
        sidebarContainer.style.cssText = `
            position: fixed;
            top: 0;
            right: 0;
            width: min(600px, 90vw);
            height: 100vh;
            background: white;
            box-shadow: -4px 0 16px rgba(0,0,0,0.2);
            z-index: 9998;
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        // Header mit Schließen-Button
        const header = document.createElement("div");
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: linear-gradient(135deg, #1e88e5 0%, #1565c0 100%);
            color: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;
        
        header.innerHTML = `
            <h2 style="margin: 0; font-size: 20px; font-family: 'Roboto', sans-serif; font-weight: 500;">
                AdminPlus
            </h2>
            <button id="tkh-plus-close" style="
                background: transparent;
                border: none;
                color: white;
                font-size: 28px;
                cursor: pointer;
                padding: 4px 8px;
                line-height: 1;
                border-radius: 4px;
                transition: background 0.2s;
            " title="Schließen">×</button>
        `;

        // iFrame für Sidebar-Inhalt
        const iframe = document.createElement("iframe");
        iframe.src = browser.runtime.getURL("sidebar.html");
        iframe.style.cssText = `
            flex: 1;
            border: none;
            width: 100%;
        `;

        sidebarIframe = iframe;
        iframe.addEventListener('load', () => {
            sendAuthStatusToSidebar();
        });

        sidebarContainer.appendChild(header);
        sidebarContainer.appendChild(iframe);
        
        document.body.appendChild(overlay);
        document.body.appendChild(sidebarContainer);

        // Schließen-Button Event
        document.getElementById("tkh-plus-close").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleSidebar();
        });

        // Close-Button Hover
        const closeBtn = document.getElementById("tkh-plus-close");
        closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.background = "rgba(255,255,255,0.2)";
        });
        closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.background = "transparent";
        });

        // Animation einleiten
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.style.opacity = "1";
                sidebarContainer.style.transform = "translateX(0)";
            });
        });

        console.log("AdminPlus: Sidebar geöffnet");
    }

    // ESC-Taste zum Schließen
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && document.getElementById("tkh-plus-sidebar")) {
            toggleSidebar();
        }
    });
})();
