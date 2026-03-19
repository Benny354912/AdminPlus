// AdminPlus - Sidebar Navigation
(function () {
    'use strict';

    let allUsers = [];
    let filteredUsers = [];
    let selectedUsers = new Set();
    let currentPage = 1;
    let pageSize = 25;
    let authState = null;
    let settings = {
        showCutlines: true,
        senderAddress: ''
    };

    // Initialisierung wenn DOM geladen ist
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        console.log('AdminPlus Sidebar geladen');
        
        // Navigation Event Listeners
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => handleNavigation(item));
        });

        // Button Event Listeners
        setupButtonHandlers();
        setupAddressHandlers();
        loadSettings();

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
            applyAuthState(data.payload || { loggedIn: false });
        }
    }

    function applyAuthState(state) {
        const loggedIn = !!state?.loggedIn;
        document.body.dataset.loggedIn = loggedIn ? 'true' : 'false';

        const navAdressen = document.querySelector('.nav-item[data-page="adressen"]');
        if (navAdressen) {
            navAdressen.classList.toggle('hidden', !loggedIn);
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
    }

    function setupButtonHandlers() {
        // Alle Buttons mit Event Listenern versehen
        const buttons = document.querySelectorAll('button.btn-primary, button.btn-secondary');
        buttons.forEach(button => {
            button.addEventListener('click', function() {
                showNotification(this.textContent + ' - Funktion in Entwicklung');
            });
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
})();
