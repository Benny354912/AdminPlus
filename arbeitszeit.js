// AdminPlus - Arbeitszeit-Erfassung mit echter API
(function () {
    'use strict';

    const DEBUG = true;
    const log = (msg, data) => {
        if (!DEBUG) return;
        console.log('%c[Arbeitszeit]', 'color: #ff9800; font-weight: bold;', msg, data || '');
    };

    // State
    let currentDate = new Date();
    let workingData = {}; // { 'YYYY-MM-DD': { hours, entries: [...], visible: true } }
    let allWorkEntries = [];
    let cancelOperationRequested = false;
    let currentUserId = null; // Will be loaded from API
    let currentShowingDetailDate = null; // Für Schnell-Add im day-detail Modal
    const loadedYears = new Set(); // Cache: Jahre, für die bereits alle Daten geladen sind
    
    // API
    const apiBaseUrl = 'https://tkh.iw-erp.de';

    // Init
    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('message', handleAuthMessage);

    function init() {
        log('Arbeitszeit Modul initialisiert');
        setupEventListeners();
        requestAuthStatus();
    }

    function setupEventListeners() {
        // Navigation
        document.getElementById('prev-month')?.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            loadWorkingData(); // Lade neue Daten für den Monat!
            renderCalendar();
        });

        document.getElementById('next-month')?.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            loadWorkingData(); // Lade neue Daten für den Monat!
            renderCalendar();
        });

        document.getElementById('today-btn')?.addEventListener('click', () => {
            currentDate = new Date();
            loadWorkingData(); // Lade neue Daten für heute!
            renderCalendar();
        });

        // Action Buttons
        document.getElementById('quick-add-time')?.addEventListener('click', openQuickAddModal);
        document.getElementById('batch-add-time')?.addEventListener('click', openBatchAddModal);
        
        // Quick Add Modal
        document.getElementById('close-quick-add')?.addEventListener('click', closeQuickAddModal);
        document.getElementById('cancel-quick-add')?.addEventListener('click', closeQuickAddModal);
        document.getElementById('submit-quick-add')?.addEventListener('click', submitQuickAdd);

        // Batch Add Modal
        document.getElementById('close-batch-add')?.addEventListener('click', closeBatchAddModal);
        document.getElementById('cancel-batch-add')?.addEventListener('click', closeBatchAddModal);
        document.getElementById('submit-batch-add')?.addEventListener('click', submitBatchAdd);
        
        document.getElementById('batch-start-date')?.addEventListener('change', onBatchDateChanged);
        document.getElementById('batch-end-date')?.addEventListener('change', onBatchDateChanged);
        document.getElementById('batch-weekdays-only')?.addEventListener('change', updateBatchPreview);
        document.getElementById('batch-skip-vacation')?.addEventListener('change', updateBatchPreview);
        document.getElementById('batch-skip-sick')?.addEventListener('change', updateBatchPreview);
        document.getElementById('batch-skip-holiday')?.addEventListener('change', updateBatchPreview);
        document.getElementById('batch-skip-existing')?.addEventListener('change', updateBatchPreview);
        
        // Custom Wochentag Toggle
        document.getElementById('batch-custom-weekdays')?.addEventListener('change', (e) => {
            document.getElementById('batch-standard-times').classList.toggle('hidden', e.target.checked);
            document.getElementById('batch-weekday-times').classList.toggle('hidden', !e.target.checked);
        });

        // Edit Modal
        document.getElementById('close-edit-time')?.addEventListener('click', closeEditModal);
        document.getElementById('cancel-edit-time')?.addEventListener('click', closeEditModal);
        document.getElementById('submit-edit-time')?.addEventListener('click', submitEditTime);
        document.getElementById('delete-edit-time')?.addEventListener('click', deleteEditTime);

        // Day Detail Modal
        document.getElementById('close-day-detail')?.addEventListener('click', closeDayDetailModal);
        document.getElementById('close-day-detail-btn')?.addEventListener('click', closeDayDetailModal);
        document.getElementById('add-quick-entry-btn')?.addEventListener('click', openQuickAddEntryForDay);
        
        // Event Delegation REMOVED - Event-Listener werden direkt in showDayDetail() angehängt
        // (zuverlässiger und debuggbar)

        // Progress
        document.getElementById('cancel-progress')?.addEventListener('click', cancelOperation);

        // Hide Urlaub/Krankheit Button wenn vorhanden
        const leaveBtn = document.getElementById('request-leave');
        if (leaveBtn) leaveBtn.style.display = 'none';
    }

    function requestAuthStatus() {
        if (window.parent) {
            window.parent.postMessage({ type: 'AdminPlusRequestAuth' }, '*');
        }
    }

    function handleAuthMessage(event) {
        const data = event?.data;
        if (data?.type === 'AdminPlusAuth' && data.payload?.loggedIn) {
            loadWorkingData();
        }
    }

    // ==================== API ====================

    function getSessionId() {
        return new Promise((resolve) => {
            // Versuche 1: Message vom Parent (aus sidebar.js)
            window.parent.postMessage({ type: 'AdminPlusRequestSessionId' }, '*');
            
            let resolved = false;
            
            const handler = (event) => {
                if (resolved) return;
                if (event?.data?.type === 'AdminPlusSessionId' && event.data.sessionId) {
                    resolved = true;
                    window.removeEventListener('message', handler);
                    log('Session-ID von Parent erhalten:', event.data.sessionId.substring(0, 10) + '...');
                    resolve(event.data.sessionId);
                }
            };
            
            window.addEventListener('message', handler);
            
            // Timeout nach 3 Sekunden
            setTimeout(() => {
                if (resolved) return;
                window.removeEventListener('message', handler);
                
                // Versuch 2: Aus localStorage
                const stored = localStorage.getItem('AdminPlusSessionId');
                if (stored) {
                    log('Session-ID aus localStorage');
                    resolved = true;
                    resolve(stored);
                    return;
                }
                
                // Versuch 3: Leer return (API wird dann 401 geben)
                log('Warnung: Keine Session-ID gefunden');
                resolved = true;
                resolve('');
            }, 3000);
        });
    }

    async function loadWorkingData() {
        try {
            log('Lade Arbeitszeiten für ' + currentDate.getFullYear());
            
            const sessionId = await getSessionId();
            if (!sessionId) {
                log('✗ Fehler: Keine Session-ID');
                renderCalendar();
                await updateStats();
                return;
            }
            const year = currentDate.getFullYear();
            
            // Versuche verschiedene URL-Varianten
            const urlVariants = [
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?user=599&year=${year}&month=0&withFutureEntries=1&monthOrder=ASC`,
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?year=${year}&month=0&withFutureEntries=1&monthOrder=ASC`,
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?year=${year}`,
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months`
            ];
            
            let response = null;
            let successUrl = null;
            
            for (const url of urlVariants) {
                response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-session-token': sessionId
                    }
                }).catch(() => null);
                
                if (response && response.ok) {
                    successUrl = url;
                    break;
                }
            }

            if (response && response.ok) {
                const data = await response.json();
                
                // Parse grouped data
                workingData = {};
                allWorkEntries = [];
                loadedYears.clear(); // Cache zurücksetzen, damit ensureTimeRangeLoaded neu lädt
                
                // Die Response ist ein Array von Monatsobjekten
                // Struktur: [ { dates: [ { start_date: "YYYY-MM-DD", entries: [...], plan_content_types, plan_duration, ... }, ... ], ... }, ... ]
                if (Array.isArray(data)) {
                    log(`✓ Response ist Array mit ${data.length} Monaten`);
                    
                    data.forEach((monthData, monthIndex) => {
                        if (!monthData || !Array.isArray(monthData.dates)) {
                            return;
                        }
                        
                        const monthStr = `${monthData.start_year}-${String(monthData.start_month).padStart(2, '0')}`;
                        let monthTotalHours = 0;
                        let monthEntryCount = 0;
                        
                        // WICHTIG: Initialisiere ALLE Tage des Monats als 'empty'
                        const daysInMonth = new Date(monthData.start_year, monthData.start_month, 0).getDate();
                        for (let day = 1; day <= daysInMonth; day++) {
                            const dateStr = `${monthData.start_year}-${String(monthData.start_month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            if (!workingData[dateStr]) {
                                workingData[dateStr] = {
                                    hours: 0,
                                    entries: [],
                                    planType: null,
                                    planHours: 0,
                                    type: 'empty'
                                };
                            }
                        }
                        
                        // Iterate durch alle TAGE im Monat (von API)
                        monthData.dates.forEach(dayObj => {
                            if (!dayObj || !dayObj.start_date) {
                                return;
                            }
                            
                            const dateStr = dayObj.start_date; // Format: YYYY-MM-DD
                            
                            // Initialisiere Day-Daten mit plan_content_types und plan_duration
                            if (!workingData[dateStr]) {
                                workingData[dateStr] = { 
                                    hours: 0, 
                                    entries: [],
                                    planType: dayObj.plan_content_types, // z.B. CT_VACATION, CT_HOLIDAY, CT_FREE_DAY
                                    planHours: dayObj.plan_duration ? (dayObj.plan_duration / 3600) : 0,
                                    type: 'empty'
                                };
                            }
                            
                            // Bestimme Typ: Erst Einträge prüfen, dann planType
                            let dayType = 'empty';
                            let hasNonWorkEntry = false;
                            
                            // Die echten Arbeitszeiten sind in dayObj.entries Array!
                            if (Array.isArray(dayObj.entries) && dayObj.entries.length > 0) {
                                dayObj.entries.forEach(entry => {
                                    if (entry) {
                                        const hours = entry.duration ? (entry.duration / 3600) : 0;
                                        const contentType = entry.content_type ? entry.content_type.toUpperCase() : '';
                                        
                                        workingData[dateStr].entries.push(entry);
                                        
                                        // Summiere Stunden pro Tag
                                        workingData[dateStr].hours += Math.round(hours * 4) / 4;
                                        
                                        // Setze Typ basierend auf content_type
                                        if (contentType === 'VACATION') {
                                            dayType = 'vacation';
                                            hasNonWorkEntry = true;
                                        } else if (contentType === 'HOLIDAY' || contentType === 'PUBLIC_HOLIDAY') {
                                            dayType = 'public_holiday';
                                            hasNonWorkEntry = true;
                                        } else if (contentType === 'SICK_LEAVE' || contentType === 'SICK') {
                                            dayType = 'sick_leave';
                                            hasNonWorkEntry = true;
                                        } else if (contentType === 'WORK') {
                                            if (dayType === 'empty') dayType = 'work';
                                            allWorkEntries.push(entry);
                                            monthTotalHours += hours;
                                            monthEntryCount++;
                                        }
                                    }
                                });
                            }
                            
                            // Falls keine non-work Einträge, aber planType vorhanden: nutze planType
                            if (!hasNonWorkEntry && dayObj.plan_content_types) {
                                const planType = dayObj.plan_content_types.toUpperCase();
                                if (planType.includes('VACATION')) {
                                    dayType = 'vacation';
                                } else if (planType.includes('HOLIDAY') || planType.includes('PUBLIC')) {
                                    dayType = 'public_holiday';
                                } else if (planType.includes('SICK')) {
                                    dayType = 'sick_leave';
                                }
                            }
                            
                            workingData[dateStr].type = dayType;
                            // Update plan-Daten falls vorhanden
                            if (dayObj.plan_content_types) {
                                workingData[dateStr].planType = dayObj.plan_content_types;
                                workingData[dateStr].planHours = dayObj.plan_duration ? (dayObj.plan_duration / 3600) : 0;
                            }
                        });
                        
                        if (monthEntryCount > 0) {
                            log(`  Monat ${monthStr}: ${monthEntryCount} Einträge, ${Math.round(monthTotalHours * 100) / 100}h total`);
                        }
                    });
                }
                
                log(`✓ Geladen: ${allWorkEntries.length} Arbeitszeiten aus ${Object.keys(workingData).length} Tagen`);
                
                if (allWorkEntries.length === 0) {
                    log('⚠ Keine Arbeitszeiten für ' + year + ' gefunden (dates oder entries Arrays leer)');
                }
                
                // Empfehlungen generieren
                updateRecommendations();
                // Jahr als geladen markieren (damit Batch-Add es nicht nochmal lädt)
                loadedYears.add(year);
            } else {
                log(`✗ API fehlgeschlagen: HTTP ${response?.status || 'error'}`);
            }

            renderCalendar();
            await updateStats();

        } catch (err) {
            log('✗ Fehler beim Laden:', err.message);
            renderCalendar();
            await updateStats();
        }
    }

    // ==================== KALENDER ====================

    function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        // Header
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                           'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        document.getElementById('month-year').textContent = `${monthNames[month]} ${year}`;

        const calendar = document.getElementById('calendar');
        calendar.innerHTML = '';
        calendar.style.display = 'grid';
        calendar.style.gridTemplateColumns = 'repeat(7, 1fr)';
        calendar.style.gap = '8px';

        // Day headers
        const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
        dayNames.forEach(day => {
            const header = document.createElement('div');
            header.style.textAlign = 'center';
            header.style.fontWeight = '600';
            header.style.fontSize = '12px';
            header.style.color = '#757575';
            header.style.padding = '8px 0';
            header.style.borderBottom = '1px solid #e0e0e0';
            header.textContent = day;
            calendar.appendChild(header);
        });

        // Berechne erste Tag (0=Montag, 6=Sonntag)
        const firstDay = new Date(year, month, 1);
        let dayOfWeek = firstDay.getDay() - 1;
        if (dayOfWeek < 0) dayOfWeek = 6;

        // Vorherige Monatstage
        const prevMonthDays = new Date(year, month, 0).getDate();
        for (let i = dayOfWeek; i > 0; i--) {
            const day = prevMonthDays - i + 1;
            const date = new Date(year, month - 1, day);
            renderCalendarDay(calendar, date, true);
        }

        // Aktuelle Monatstage
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            renderCalendarDay(calendar, date, false);
        }

        // Nächste Monatstage (für 6 Wochen Grid)
        const totalCells = 7 + dayOfWeek + daysInMonth; // 7 Headers + content
        const remainingCells = 42 - (dayOfWeek + daysInMonth);
        for (let day = 1; day <= remainingCells; day++) {
            const date = new Date(year, month + 1, day);
            renderCalendarDay(calendar, date, true);
        }
    }

    function renderCalendarDay(container, date, isOtherMonth) {
        const dayDiv = document.createElement('div');
        const dateStr = formatDate(date);
        
        dayDiv.style.aspectRatio = '1';
        dayDiv.style.border = '1px solid #e0e0e0';
        dayDiv.style.borderRadius = '6px';
        dayDiv.style.padding = '8px';
        dayDiv.style.cursor = isOtherMonth ? 'default' : 'pointer';
        dayDiv.style.display = 'flex';
        dayDiv.style.flexDirection = 'column';
        dayDiv.style.gap = '4px';
        dayDiv.style.fontSize = '11px';
        dayDiv.style.background = 'white';
        dayDiv.style.overflow = 'hidden';
        dayDiv.style.transition = 'all 0.2s ease';
        
        if (isOtherMonth) {
            dayDiv.style.opacity = '0.4';
            dayDiv.style.background = '#f5f5f5';
        }
        
        // Heute
        const today = formatDate(new Date());
        if (dateStr === today && !isOtherMonth) {
            dayDiv.style.border = '2px solid #1e88e5';
            dayDiv.style.background = 'rgba(30, 136, 229, 0.05)';
        }

        // Wochenende
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            dayDiv.style.background = isOtherMonth ? '#f5f5f5' : '#f9f9f9';
        }

        // Arbeitszeitstatus & Urlaub/Feiertage
        const workData = workingData[dateStr];
        
        // Färbung nach Haupttyp (erste Arbeitszeit bestimmt die Farbe)
        if (workData && workData.entries && workData.entries.length > 0) {
            // Finde den Haupttyp für die Färbung
            const hasWork = workData.entries.some(e => e.content_type?.toUpperCase() === 'WORK');
            const hasVacation = workData.entries.some(e => e.content_type?.toUpperCase() === 'VACATION');
            const hasHoliday = workData.entries.some(e => e.content_type?.toUpperCase() === 'HOLIDAY' || e.content_type?.toUpperCase() === 'PUBLIC_HOLIDAY');
            const hasSickLeave = workData.entries.some(e => e.content_type?.toUpperCase() === 'SICK' || e.content_type?.toUpperCase() === 'SICK_LEAVE');
            
            // Priorität: Vacation > Holiday > SickLeave > Work
            if (hasVacation) {
                dayDiv.style.background = 'rgba(156, 39, 176, 0.1)';
                dayDiv.style.borderColor = '#9c27b0';
            } else if (hasHoliday) {
                dayDiv.style.background = 'rgba(255, 87, 34, 0.1)';
                dayDiv.style.borderColor = '#ff5722';
            } else if (hasSickLeave) {
                dayDiv.style.background = 'rgba(244, 67, 54, 0.1)';
                dayDiv.style.borderColor = '#f44336';
            } else if (hasWork) {
                if (workData.hours >= 8) {
                    dayDiv.style.background = 'rgba(76, 175, 80, 0.1)';
                    dayDiv.style.borderColor = '#4caf50';
                } else {
                    dayDiv.style.background = 'rgba(255, 152, 0, 0.1)';
                    dayDiv.style.borderColor = '#ff9800';
                }
            }
            dayDiv.style.borderWidth = '2px';
        } else if (workData) {
            // Überprüfe planType wenn keine Einträge vorhanden sind
            if (workData.planType) {
                const planType = workData.planType.toUpperCase();
                if (planType.includes('VACATION')) {
                    dayDiv.style.background = 'rgba(156, 39, 176, 0.1)';
                    dayDiv.style.borderColor = '#9c27b0';
                    dayDiv.style.borderWidth = '2px';
                } else if (planType.includes('HOLIDAY') || planType.includes('PUBLIC')) {
                    dayDiv.style.background = 'rgba(255, 87, 34, 0.1)';
                    dayDiv.style.borderColor = '#ff5722';
                    dayDiv.style.borderWidth = '2px';
                } else if (planType.includes('SICK')) {
                    dayDiv.style.background = 'rgba(244, 67, 54, 0.1)';
                    dayDiv.style.borderColor = '#f44336';
                    dayDiv.style.borderWidth = '2px';
                }
            }
        }

        // Datum
        const dateSpan = document.createElement('div');
        dateSpan.style.fontWeight = '600';
        dateSpan.style.color = '#212121';
        dateSpan.style.fontSize = '13px';
        dateSpan.textContent = date.getDate();
        dayDiv.appendChild(dateSpan);

        // Stunden und Status - mehrere Typen möglich
        if (workData && workData.entries && workData.entries.length > 0) {
            // Zeige Arbeitszeiten
            const hasWork = workData.entries.some(e => e.content_type?.toUpperCase() === 'WORK');
            if (hasWork && workData.hours > 0) {
                const timeSpan = document.createElement('div');
                timeSpan.style.fontSize = '10px';
                timeSpan.style.color = '#1565c0';
                timeSpan.style.fontWeight = '500';
                timeSpan.textContent = `${workData.hours}h`;
                dayDiv.appendChild(timeSpan);
            }
            
            // Zeige alle Typen als Icons (mehrere pro Tag möglich!)
            const typesDisplay = document.createElement('div');
            typesDisplay.style.fontSize = '9px';
            typesDisplay.style.fontWeight = '600';
            typesDisplay.style.display = 'flex';
            typesDisplay.style.gap = '2px';
            typesDisplay.style.flexWrap = 'wrap';
            
            const hasVacation = workData.entries.some(e => e.content_type?.toUpperCase() === 'VACATION');
            const hasHoliday = workData.entries.some(e => e.content_type?.toUpperCase() === 'HOLIDAY' || e.content_type?.toUpperCase() === 'PUBLIC_HOLIDAY');
            const hasSickLeave = workData.entries.some(e => e.content_type?.toUpperCase() === 'SICK' || e.content_type?.toUpperCase() === 'SICK_LEAVE');
            
            if (hasVacation) {
                const icon = document.createElement('span');
                icon.style.color = '#9c27b0';
                icon.textContent = '🏖';
                typesDisplay.appendChild(icon);
            }
            if (hasHoliday) {
                const icon = document.createElement('span');
                icon.style.color = '#ff5722';
                icon.textContent = '🎉';
                typesDisplay.appendChild(icon);
            }
            if (hasSickLeave) {
                const icon = document.createElement('span');
                icon.style.color = '#f44336';
                icon.textContent = '🤒';
                typesDisplay.appendChild(icon);
            }
            
            if (typesDisplay.children.length > 0) {
                dayDiv.appendChild(typesDisplay);
            }
            
            // Status: Unvollständig
            if (hasWork && workData.hours < 8 && workData.planHours >= 8) {
                const statusSpan = document.createElement('div');
                statusSpan.style.fontSize = '9px';
                statusSpan.style.color = '#ff9800';
                statusSpan.style.fontWeight = '600';
                statusSpan.textContent = 'Unvollst.';
                dayDiv.appendChild(statusSpan);
            }
        } else if (workData) {
            // Keine Einträge - überprüfe planType
            if (workData.planType) {
                const planType = workData.planType.toUpperCase();
                const typesDisplay = document.createElement('div');
                typesDisplay.style.fontSize = '9px';
                typesDisplay.style.fontWeight = '600';
                typesDisplay.style.display = 'flex';
                typesDisplay.style.gap = '2px';
                typesDisplay.style.flexWrap = 'wrap';
                
                if (planType.includes('VACATION')) {
                    const icon = document.createElement('span');
                    icon.style.color = '#9c27b0';
                    icon.textContent = '🏖 Urlaub';
                    typesDisplay.appendChild(icon);
                } else if (planType.includes('HOLIDAY') || planType.includes('PUBLIC')) {
                    const icon = document.createElement('span');
                    icon.style.color = '#ff5722';
                    icon.textContent = '🎉 Feiertag';
                    typesDisplay.appendChild(icon);
                } else if (planType.includes('SICK')) {
                    const icon = document.createElement('span');
                    icon.style.color = '#f44336';
                    icon.textContent = '🤒 Krankheit';
                    typesDisplay.appendChild(icon);
                }
                
                if (typesDisplay.children.length > 0) {
                    dayDiv.appendChild(typesDisplay);
                }
            } else if (workData.planHours > 0 && workData.hours === 0) {
                // Soll-Zeit ohne Arbeitszeiten (Empfehlung)
                const suggestSpan = document.createElement('div');
                suggestSpan.style.fontSize = '9px';
                suggestSpan.style.color = '#1565c0';
                suggestSpan.style.fontWeight = '600';
                suggestSpan.textContent = `${workData.planHours}h📋`;
                dayDiv.appendChild(suggestSpan);
            }
        } else if (!isOtherMonth && (dayOfWeek >= 1 && dayOfWeek <= 5)) {
            // Keine Arbeit an Werkeltag
            const noDataSpan = document.createElement('div');
            noDataSpan.style.fontSize = '9px';
            noDataSpan.style.color = '#999';
            noDataSpan.textContent = '—';
            dayDiv.appendChild(noDataSpan);
        }

        // Hover
        dayDiv.addEventListener('mouseenter', () => {
            if (!isOtherMonth) {
                dayDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                dayDiv.style.transform = 'translateY(-2px)';
            }
        });
        dayDiv.addEventListener('mouseleave', () => {
            dayDiv.style.boxShadow = 'none';
            dayDiv.style.transform = 'translateY(0)';
        });

        // Mache ALLE Tage klickbar (auch andere Monate), dann checken wir in showDayDetail
        dayDiv.addEventListener('click', () => showDayDetail(date));
        container.appendChild(dayDiv);
    }

    // ==================== STATISTIKEN ====================

    async function updateStats() {
        let totalHoursPastThisYear = 0;
        const currentYear = new Date().getFullYear();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const dateStr in workingData) {
            if (workingData[dateStr].type === 'work') {
                const date = new Date(dateStr);
                date.setHours(0, 0, 0, 0);
                // NUR Stunden bis heute zählen - nicht Zukunft!
                if (date.getFullYear() === currentYear && date <= today) {
                    totalHoursPastThisYear += workingData[dateStr].hours;
                }
            }
        }

        // HINWEIS: Überstunden werden direkt von der API berechnet!
        // Wir rufen hier einen speziellen Endpoint auf um die API-Überstunden zu laden
        await loadOvertimeFromAPI();
        
        document.getElementById('stat-vacation').textContent = '20 Tage';
        document.getElementById('stat-sick').textContent = '0 Tage';
        
        const thisMonthHours = getMonthHours(currentDate.getMonth(), currentDate.getFullYear());
        document.getElementById('stat-month-hours').textContent = Math.round(thisMonthHours * 4) / 4 + 'h';
    }

    async function loadOvertimeFromAPI() {
        try {
            const sessionId = await getSessionId();
            if (!sessionId) return;

            // Hole Überstunden von der API
            const url = `${apiBaseUrl}/api/dw/short_information?className=work_time_entry&addon=list&person=4297&workTimeCard=1`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-token': sessionId,
                    'x-iw-convert-to-camel-case': '1'
                }
            });

            if (response.ok) {
                const data = await response.json();
                
                // Finde WORK_TIME_OVERTIME_YEAR_END
                const overtimeEntry = data.find(e => e.identifier === 'WORK_TIME_OVERTIME_YEAR_END');
                if (overtimeEntry && overtimeEntry.raw_value !== null) {
                    // raw_value ist in Sekunden, konvertiere zu Stunden
                    const hours = overtimeEntry.raw_value / 3600;
                    const overtimeHours = Math.round(hours * 4) / 4;
                    document.getElementById('stat-overtime').textContent = (overtimeHours >= 0 ? '+' : '') + overtimeHours + 'h';
                    log(`✓ Überstunden von API: ${overtimeHours}h`);
                }
            }
        } catch (err) {
            log(`⚠ Überstunden-API fehler: ${err.message}`);
        }
    }

    function getMonthHours(month, year) {
        let hours = 0;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (workingData[dateStr]?.type === 'work') {
                hours += workingData[dateStr].hours;
            }
        }
        
        return hours;
    }

    // ==================== QUICK ADD ====================

    function openQuickAddEntryForDay() {
        if (!currentShowingDetailDate) {
            showNotification('Fehler: Kein Tag ausgewählt', 'error');
            return;
        }
        
        log(`[openQuickAddEntryForDay] Öffne Schnell-Add für ${currentShowingDetailDate}`);
        
        // Schließe day-detail Modal
        closeDayDetailModal();
        
        // Öffne quick-add Modal mit dem ausgewählten Datum
        document.getElementById('quick-date').value = currentShowingDetailDate;
        document.getElementById('quick-start-time').value = '09:00';
        document.getElementById('quick-end-time').value = '17:00';
        document.getElementById('quick-note').value = '';
        document.getElementById('quick-add-error').classList.add('hidden');
        document.getElementById('quick-add-modal').classList.remove('hidden');
    }

    function openQuickAddModal() {
        const today = formatDate(new Date());
        document.getElementById('quick-date').value = today;
        document.getElementById('quick-start-time').value = '09:00';
        document.getElementById('quick-end-time').value = '17:00';
        document.getElementById('quick-note').value = '';
        document.getElementById('quick-add-error').classList.add('hidden');
        document.getElementById('quick-add-modal').classList.remove('hidden');
    }

    function closeQuickAddModal() {
        document.getElementById('quick-add-modal').classList.add('hidden');
    }

    function submitQuickAdd() {
        const date = document.getElementById('quick-date').value;
        const startTime = document.getElementById('quick-start-time').value;
        const endTime = document.getElementById('quick-end-time').value;
        const note = document.getElementById('quick-note').value;
        const errorDiv = document.getElementById('quick-add-error');

        if (!date || !startTime || !endTime) {
            errorDiv.textContent = 'Bitte füllen Sie alle Felder aus.';
            errorDiv.classList.remove('hidden');
            return;
        }

        if (startTime >= endTime) {
            errorDiv.textContent = 'Startzeit muss vor Endzeit liegen.';
            errorDiv.classList.remove('hidden');
            return;
        }

        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';

        const hours = calculateHours(startTime, endTime);
        performApiAddWorktime(date, startTime, endTime, hours, note)
            .then(async () => {
                closeQuickAddModal();
                await loadWorkingData();
                renderCalendar();
                
                // Wenn dasselbe Datum noch im day-detail Modal ist, aktualisieren
                if (currentShowingDetailDate === date) {
                    const dateObj = new Date(date + 'T12:00:00');
                    showDayDetail(dateObj);
                    log(`[submitQuickAdd] Day-Detail Modal aktualisiert für ${date}`);
                }
                
                showNotification('✓ Arbeitszeit hinzugefügt', 'success');
            })
            .catch(err => {
                errorDiv.textContent = '❌ ' + err.message;
                errorDiv.classList.remove('hidden');
                log(`[submitQuickAdd] Fehler: ${err.message}`);
            });
    }

    // ==================== BATCH ADD ====================

    function openBatchAddModal() {
        const today = formatDate(new Date());
        document.getElementById('batch-start-date').value = today;
        document.getElementById('batch-end-date').value = today;
        document.getElementById('batch-start-time').value = '09:00';
        document.getElementById('batch-end-time').value = '17:00';
        document.getElementById('batch-note').value = '';
        document.getElementById('batch-weekdays-only').checked = true;
        document.getElementById('batch-skip-vacation').checked = true;
        document.getElementById('batch-skip-sick').checked = true;
        document.getElementById('batch-skip-holiday').checked = true;
        document.getElementById('batch-skip-existing').checked = true;
        document.getElementById('batch-add-error').classList.add('hidden');
        document.getElementById('batch-preview').innerHTML = '<p style="color: #666;">⟳ Lade Zeitraum...</p>';
        document.getElementById('batch-add-modal').classList.remove('hidden');
        
        // Lade den initialen Monat (heute) asynchron
        ensureTimeRangeLoaded(today, today).then(() => {
            updateBatchPreview();
        }).catch(err => {
            log('Fehler beim Laden des Zeitraums:', err);
            updateBatchPreview(); // Fallback: versuche mit bestehenden Daten
        });
    }

    function closeBatchAddModal() {
        document.getElementById('batch-add-modal').classList.add('hidden');
    }

    /**
     * Stellt sicher, dass alle Daten für einen Zeitraum geladen sind.
     * Gruppiert nach Jahren und lädt jedes benötigte Jahr komplett (identisch
     * wie loadWorkingData), damit keine Lücken entstehen.
     * @param {string} startDateStr - YYYY-MM-DD
     * @param {string} endDateStr   - YYYY-MM-DD
     */
    async function ensureTimeRangeLoaded(startDateStr, endDateStr) {
        const startDate = new Date(startDateStr + 'T00:00:00');
        const endDate   = new Date(endDateStr   + 'T00:00:00');

        // Welche Jahrgänge brauchen wir?
        const yearsNeeded = new Set();
        for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) {
            if (!loadedYears.has(y)) yearsNeeded.add(y);
        }

        if (yearsNeeded.size === 0) {
            log('Zeitraum bereits vollständig gecacht.');
            return;
        }

        log(`Lade ${yearsNeeded.size} Jahr(e) für Batch-Zeitraum: ${[...yearsNeeded].join(', ')}`);

        // Alle fehlenden Jahre parallel laden
        await Promise.all([...yearsNeeded].map(year => loadYearData(year)));
        log('✓ Alle benötigten Jahre geladen');
    }

    /**
     * Lädt ALLE 12 Monate eines Jahres von der API (month=0) und merged sie
     * in workingData – identische Parse-Logik wie loadWorkingData().
     * Markiert das Jahr als geladen, damit es nicht doppelt abgefragt wird.
     * @param {number} year
     */
    async function loadYearData(year) {
        try {
            const sessionId = await getSessionId();
            if (!sessionId) { log(`⚠ Kein Session-Token für Jahr ${year}`); return; }

            // Gleiche URL-Varianten wie loadWorkingData
            const urlVariants = [
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?user=599&year=${year}&month=0&withFutureEntries=1&monthOrder=ASC`,
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?year=${year}&month=0&withFutureEntries=1&monthOrder=ASC`,
                `${apiBaseUrl}/api/time/work_entry_grouped/own_months?year=${year}`,
            ];

            let response = null;
            for (const url of urlVariants) {
                response = await fetch(url, {
                    headers: { 'Content-Type': 'application/json', 'x-session-token': sessionId }
                }).catch(() => null);
                if (response?.ok) break;
            }

            if (!response?.ok) {
                log(`⚠ Jahr ${year} konnte nicht geladen werden`);
                return;
            }

            const data = await response.json();

            // API liefert IMMER ein Array von Monatsobjekten
            const months = Array.isArray(data) ? data : (data?.months ?? [data]);

            months.forEach(monthData => {
                if (!monthData || !Array.isArray(monthData.dates)) return;

                // Initialisiere alle Tage des Monats (wie loadWorkingData)
                const daysInMonth = new Date(monthData.start_year, monthData.start_month, 0).getDate();
                for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${monthData.start_year}-${String(monthData.start_month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    if (!workingData[dateStr]) {
                        workingData[dateStr] = { hours: 0, entries: [], planType: null, planHours: 0, type: 'empty' };
                    }
                }

                // Verarbeite Tages-Objekte – IDENTISCH zu loadWorkingData()
                monthData.dates.forEach(dayObj => {
                    if (!dayObj?.start_date) return;
                    const dateStr = dayObj.start_date;

                    if (!workingData[dateStr]) {
                        workingData[dateStr] = {
                            hours: 0, entries: [],
                            planType: dayObj.plan_content_types ?? null,
                            planHours: dayObj.plan_duration ? (dayObj.plan_duration / 3600) : 0,
                            type: 'empty'
                        };
                    }

                    let dayType = workingData[dateStr].type === 'empty' ? 'empty' : workingData[dateStr].type;
                    let hasNonWorkEntry = dayType !== 'empty' && dayType !== 'work';

                    if (Array.isArray(dayObj.entries) && dayObj.entries.length > 0) {
                        const existingIds = new Set(workingData[dateStr].entries.map(e => e.id));
                        dayObj.entries.forEach(entry => {
                            if (!entry || existingIds.has(entry.id)) return;
                            workingData[dateStr].entries.push(entry);
                            const hours = entry.duration ? (entry.duration / 3600) : 0;
                            workingData[dateStr].hours += Math.round(hours * 4) / 4;

                            const ct = entry.content_type?.toUpperCase() ?? '';
                            if (ct === 'VACATION') {
                                dayType = 'vacation'; hasNonWorkEntry = true;
                            } else if (ct === 'HOLIDAY' || ct === 'PUBLIC_HOLIDAY') {
                                dayType = 'public_holiday'; hasNonWorkEntry = true;
                            } else if (ct === 'SICK_LEAVE' || ct === 'SICK') {
                                dayType = 'sick_leave'; hasNonWorkEntry = true;
                            } else if (ct === 'WORK') {
                                if (dayType === 'empty') dayType = 'work';
                            }
                        });
                    }

                    // planType-Fallback: wie loadWorkingData()
                    if (!hasNonWorkEntry && dayObj.plan_content_types) {
                        const pt = dayObj.plan_content_types.toUpperCase();
                        if (pt.includes('VACATION'))               { dayType = 'vacation'; }
                        else if (pt.includes('HOLIDAY') || pt.includes('PUBLIC')) { dayType = 'public_holiday'; }
                        else if (pt.includes('SICK'))               { dayType = 'sick_leave'; }
                    }

                    workingData[dateStr].type = dayType;
                    if (dayObj.plan_content_types) {
                        workingData[dateStr].planType = dayObj.plan_content_types;
                        workingData[dateStr].planHours = dayObj.plan_duration ? (dayObj.plan_duration / 3600) : 0;
                    }
                });
            });

            loadedYears.add(year);
            log(`✓ Jahr ${year} vollständig geladen und gecacht`);
        } catch (err) {
            log(`Fehler beim Laden von Jahr ${year}:`, err);
        }
    }

    /**
     * Prüft zuverlässig ob ein Tag einen bestimmten Typ hat.
     * Berücksichtigt BEIDE Quellen: entries[].content_type UND workingData.type/planType.
     * WICHTIG: planType wird NICHT für 'WORK' geprüft – plan_content_types enthält
     * CT_WORK_PLAN für reguläre Arbeitstage, was keine tatsächlichen Einträge bedeutet.
     */
    function dayHasContentType(dateStr, ...contentTypes) {
        const dayData = workingData[dateStr];
        if (!dayData) return false;
        const upper = contentTypes.map(c => c.toUpperCase());

        // Ob wir nach nicht-WORK-Typen suchen (darf planType nutzen)
        const nonWorkTypes = upper.filter(u => u !== 'WORK');
        const includesWork = upper.includes('WORK');

        // 1) Prüfe gesetzten type-Wert (von loadWorkingData/loadYearData korrekt gesetzt)
        if (includesWork && (dayData.type === 'work')) return true;
        if (nonWorkTypes.length > 0) {
            if (nonWorkTypes.includes('VACATION') && dayData.type === 'vacation') return true;
            if ((nonWorkTypes.includes('HOLIDAY') || nonWorkTypes.includes('PUBLIC_HOLIDAY')) && dayData.type === 'public_holiday') return true;
            if ((nonWorkTypes.includes('SICK') || nonWorkTypes.includes('SICK_LEAVE')) && dayData.type === 'sick_leave') return true;
        }

        // 2) Prüfe entries[].content_type direkt
        if (dayData.entries?.some(e => upper.includes(e.content_type?.toUpperCase()))) return true;

        // 3) Prüfe planType NUR für Urlaub/Feiertag/Krankheit – NIEMALS für WORK!
        if (nonWorkTypes.length > 0 && dayData.planType) {
            const pt = dayData.planType.toUpperCase();
            if (nonWorkTypes.includes('VACATION') && pt.includes('VACATION')) return true;
            if ((nonWorkTypes.includes('HOLIDAY') || nonWorkTypes.includes('PUBLIC_HOLIDAY')) && (pt.includes('HOLIDAY') || pt.includes('PUBLIC'))) return true;
            if ((nonWorkTypes.includes('SICK') || nonWorkTypes.includes('SICK_LEAVE')) && pt.includes('SICK')) return true;
        }

        return false;
    }

    /**
     * Wird aufgerufen wenn Batch-Start oder Batch-End Datum geändert wird.
     * Lädt den kompletten Zeitraum vorab, dann aktualisiert die Preview.
     */
    async function onBatchDateChanged() {
        const startDate = document.getElementById('batch-start-date').value;
        const endDate = document.getElementById('batch-end-date').value;

        if (!startDate || !endDate) {
            document.getElementById('batch-preview').innerHTML = '';
            return;
        }

        // Zeige "wird geladen" Message
        document.getElementById('batch-preview').innerHTML = '<p style="color: #666;">⏳ Lade Zeitraum...</p>';

        try {
            // Lade den kompletten Zeitraum (ALLE Monate darin)
            await ensureTimeRangeLoaded(startDate, endDate);
            
            // Jetzt aktualisiere die Preview mit vollständigen Daten
            updateBatchPreview();
        } catch (err) {
            log('Fehler beim Laden des Zeitraums:', err);
            // Fallback: zeige Preview mit bestehenden Daten
            updateBatchPreview();
        }
    }

    function getBatchSkipOptions() {
        return {
            weekdaysOnly: document.getElementById('batch-weekdays-only')?.checked ?? true,
            skipVacation: document.getElementById('batch-skip-vacation')?.checked ?? true,
            skipSick: document.getElementById('batch-skip-sick')?.checked ?? true,
            skipHoliday: document.getElementById('batch-skip-holiday')?.checked ?? true,
            skipExisting: document.getElementById('batch-skip-existing')?.checked ?? true,
        };
    }

    function updateBatchPreview() {
        const startDate = document.getElementById('batch-start-date').value;
        const endDate = document.getElementById('batch-end-date').value;
        const skip = getBatchSkipOptions();

        if (!startDate || !endDate) {
            document.getElementById('batch-preview').innerHTML = '';
            return;
        }

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');

        if (start > end) {
            document.getElementById('batch-preview').innerHTML = '<p style="color: #f44336;">Start muss vor Ende liegen</p>';
            return;
        }

        const validDates = [];
        const skippedDates = [];
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay();
            const dateStr = formatDate(d);
            const displayStr = formatDateLong(d);
            
            // Überspringe Wochenenden wenn nur Wochentage gewünscht
            if (skip.weekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
                skippedDates.push({ date: displayStr, dateStr, reason: '🚫 Wochenende' });
                continue;
            }
            
            const dayData = workingData[dateStr];
            
            // Überspringe Urlaub
            if (skip.skipVacation && dayHasContentType(dateStr, 'VACATION')) {
                skippedDates.push({ date: displayStr, dateStr, reason: '🏖 Urlaub' });
                continue;
            }
            // Überspringe Krankheit
            if (skip.skipSick && dayHasContentType(dateStr, 'SICK', 'SICK_LEAVE')) {
                skippedDates.push({ date: displayStr, dateStr, reason: '🤒 Krankheit' });
                continue;
            }
            // Überspringe Feiertage
            if (skip.skipHoliday && dayHasContentType(dateStr, 'HOLIDAY', 'PUBLIC_HOLIDAY')) {
                skippedDates.push({ date: displayStr, dateStr, reason: '🎉 Feiertag' });
                continue;
            }
            // Überspringe Tage mit vorhandener Arbeitszeit
            if (skip.skipExisting && dayHasContentType(dateStr, 'WORK')) {
                skippedDates.push({ date: displayStr, dateStr, reason: '📝 Arbeitszeit bereits eingetragen' });
                continue;
            }
            
            validDates.push({ label: displayStr, dateStr });
        }

        const showAll = document.getElementById('batch-preview-show-all')?.dataset.expanded === 'true';
        const VALID_LIMIT = showAll ? validDates.length : 5;
        const SKIP_LIMIT  = showAll ? skippedDates.length : 4;

        let html = `<p style="margin: 0 0 6px;"><strong>${validDates.length} einzutragen</strong>`;
        if (skippedDates.length > 0) html += ` &nbsp;<span style="color:#999;font-size:11px;">(${skippedDates.length} übersprungen)</span>`;
        html += '</p>';

        // Gültige Tage
        if (validDates.length > 0) {
            html += '<ul style="margin: 0 0 6px; padding-left: 14px;">';
            validDates.slice(0, VALID_LIMIT).forEach(({ label }) => {
                html += `<li style="font-size: 12px; color: #4caf50;">&#10003; ${label}</li>`;
            });
            html += '</ul>';
        }

        // Übersprungene Tage
        if (skippedDates.length > 0) {
            html += '<details style="margin-top: 4px;"><summary style="font-size: 11px; color: #f44336; cursor: pointer; font-weight: 600;">Übersprungen (' + skippedDates.length + ')</summary>';
            html += '<ul style="margin: 4px 0; padding-left: 14px;">';
            skippedDates.slice(0, SKIP_LIMIT).forEach(({ date, reason }) => {
                html += `<li style="font-size: 11px; color: #f44336;">${reason}: ${date}</li>`;
            });
            html += '</ul></details>';
        }

        // Toggle für vollständige Liste
        if (validDates.length > 5) {
            const expanded = showAll;
            html += `<button id="batch-preview-show-all" data-expanded="${expanded}" 
                style="margin-top:6px; font-size:11px; background:none; border:1px solid #bbb; border-radius:4px; padding:2px 8px; cursor:pointer; color:#555;">
                ${expanded ? '&#9650; Weniger anzeigen' : '&#9660; Alle ' + validDates.length + ' Tage anzeigen'}
            </button>`;
        }

        document.getElementById('batch-preview').innerHTML = html;

        // Toggle-Button Event
        document.getElementById('batch-preview-show-all')?.addEventListener('click', () => {
            const btn = document.getElementById('batch-preview-show-all');
            btn.dataset.expanded = btn.dataset.expanded === 'true' ? 'false' : 'true';
            updateBatchPreview();
        });
    }

    async function submitBatchAdd() {
        const startDate = document.getElementById('batch-start-date').value;
        const endDate = document.getElementById('batch-end-date').value;
        const useCustomWeekdays = document.getElementById('batch-custom-weekdays').checked;
        const skip = getBatchSkipOptions();
        const errorDiv = document.getElementById('batch-add-error');
        errorDiv.classList.add('hidden');

        if (!startDate || !endDate) {
            errorDiv.textContent = 'Bitte füllen Sie die Daten aus.';
            errorDiv.classList.remove('hidden');
            return;
        }

        // Validiere Zeiten
        if (!useCustomWeekdays) {
            const startTime = document.getElementById('batch-start-time').value;
            const endTime = document.getElementById('batch-end-time').value;
            
            if (!startTime || !endTime) {
                errorDiv.textContent = 'Bitte füllen Sie alle Felder aus.';
                errorDiv.classList.remove('hidden');
                return;
            }

            if (startTime >= endTime) {
                errorDiv.textContent = 'Von-Zeit muss vor Bis-Zeit liegen.';
                errorDiv.classList.remove('hidden');
                return;
            }
        }

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');

        if (start > end) {
            errorDiv.textContent = 'Start muss vor Ende liegen.';
            errorDiv.classList.remove('hidden');
            return;
        }

        // ── SICHERHEITS-SCHRITT: Kompletten Zeitraum vorab laden ──────────────
        // Unabhängig davon ob die Preview schon geladen hat, laden wir hier
        // nochmals den Zeitraum, damit keine Lücken entstehen.
        const submitBtn = document.getElementById('submit-batch-add');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Lade Daten...'; }

        try {
            await ensureTimeRangeLoaded(startDate, endDate);
        } catch (err) {
            log('Fehler beim Laden des Zeitraums vor Submit:', err);
            // Fortfahren mit vorhandenen Daten statt abbrechen
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Hinzufügen'; }
        }
        // ──────────────────────────────────────────────────────────────────────

        const dates = [];
        const skippedReasons = {};
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay();
            const dateStr = formatDate(d);
            
            // Überspringe Wochenenden wenn nur Wochentage gewünscht
            if (skip.weekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
                skippedReasons[dateStr] = 'Wochenende';
                continue;
            }
            
            const dayData = workingData[dateStr];
            const entries = dayData?.entries || [];
            
            // Überspringe Urlaub
            if (skip.skipVacation && dayHasContentType(dateStr, 'VACATION')) {
                skippedReasons[dateStr] = 'Urlaub vorhanden';
                continue;
            }
            // Überspringe Krankheit
            if (skip.skipSick && dayHasContentType(dateStr, 'SICK', 'SICK_LEAVE')) {
                skippedReasons[dateStr] = 'Krankheit vorhanden';
                continue;
            }
            // Überspringe Feiertage
            if (skip.skipHoliday && dayHasContentType(dateStr, 'HOLIDAY', 'PUBLIC_HOLIDAY')) {
                skippedReasons[dateStr] = 'Feiertag vorhanden';
                continue;
            }
            // Überspringe Tage mit vorhandener Arbeitszeit
            if (skip.skipExisting && dayHasContentType(dateStr, 'WORK')) {
                skippedReasons[dateStr] = 'Arbeitszeit bereits eingetragen';
                continue;
            }
            
            dates.push(dateStr);
        }

        if (dates.length === 0) {
            const reasons = Object.values(skippedReasons).filter((v, i, a) => a.indexOf(v) === i);
            errorDiv.textContent = `Keine Tage zum Eintragen (${reasons.join(', ')}).`;
            errorDiv.classList.remove('hidden');
            return;
        }

        closeBatchAddModal();

        if (useCustomWeekdays) {
            const weekdayTimes = {
                0: { start: document.getElementById('batch-sun-start').value, end: document.getElementById('batch-sun-end').value },
                1: { start: document.getElementById('batch-mon-start').value, end: document.getElementById('batch-mon-end').value },
                2: { start: document.getElementById('batch-tue-start').value, end: document.getElementById('batch-tue-end').value },
                3: { start: document.getElementById('batch-wed-start').value, end: document.getElementById('batch-wed-end').value },
                4: { start: document.getElementById('batch-thu-start').value, end: document.getElementById('batch-thu-end').value },
                5: { start: document.getElementById('batch-fri-start').value, end: document.getElementById('batch-fri-end').value },
                6: { start: document.getElementById('batch-sat-start').value, end: document.getElementById('batch-sat-end').value }
            };
            performBatchAddCustom(dates, skippedReasons, weekdayTimes, document.getElementById('batch-note').value);
        } else {
            const startTime = document.getElementById('batch-start-time').value;
            const endTime = document.getElementById('batch-end-time').value;
            performBatchAdd(dates, skippedReasons, startTime, endTime, document.getElementById('batch-note').value);
        }
    }

    function performBatchAdd(dates, skippedReasons, startTime, endTime, note) {
        cancelOperationRequested = false;
        const total = dates.length;
        const total_skipped = Object.keys(skippedReasons).length;
        
        showProgress(`Arbeitszeiten hinzufügen (${total} + ${total_skipped} übersprungen)`, total);

        const hours = calculateHours(startTime, endTime);
        let completed = 0;
        let failed = 0;

        const processNext = (index) => {
            if (cancelOperationRequested || index >= dates.length) {
                if (cancelOperationRequested) {
                    hideProgress();
                    showNotification('⊘ Abgebrochen', 'warning');
                } else {
                    const status = failed > 0 
                        ? `✓ ${completed}/${total} Einträge hinzugefügt (${failed} Fehler)`
                        : `✓ ${total} Einträge erfolgreich hinzugefügt`;
                    hideProgress();
                    loadWorkingData();
                    showNotification(status, 'success');
                }
                return;
            }

            const dateStr = dates[index];
            
            performApiAddWorktime(dateStr, startTime, endTime, hours, note)
                .then(() => {
                    completed++;
                    updateProgress(completed, total, `${completed}/${total} Tage eingetragen...`);
                    setTimeout(() => processNext(index + 1), 150);
                })
                .catch((err) => {
                    completed++;
                    failed++;
                    log(`⚠ Fehler bei ${dateStr}: ${err.message}`);
                    updateProgress(completed, total, `${completed}/${total} (${failed} Fehler)`);
                    setTimeout(() => processNext(index + 1), 150);
                });
        };

        processNext(0);
    }

    function performBatchAddCustom(dates, skippedReasons, weekdayTimes, note) {
        cancelOperationRequested = false;
        const total = dates.length;
        const total_skipped = Object.keys(skippedReasons).length;
        
        showProgress(`Arbeitszeiten hinzufügen (${total} + ${total_skipped} übersprungen)`, total);

        let completed = 0;
        let failed = 0;

        const processNext = (index) => {
            if (cancelOperationRequested || index >= dates.length) {
                if (cancelOperationRequested) {
                    hideProgress();
                    showNotification('⊘ Abgebrochen', 'warning');
                } else {
                    const status = failed > 0 
                        ? `✓ ${completed}/${total} Einträge hinzugefügt (${failed} Fehler)`
                        : `✓ ${total} Einträge erfolgreich hinzugefügt`;
                    hideProgress();
                    loadWorkingData();
                    showNotification(status, 'success');
                }
                return;
            }

            const dateStr = dates[index];
            const date = new Date(dateStr);
            const dayOfWeek = date.getDay();
            const times = weekdayTimes[dayOfWeek];

            if (!times || !times.start || !times.end) {
                completed++;
                failed++;
                log(`⚠ Keine Zeiten für ${dateStr} (${['So','Mo','Di','Mi','Do','Fr','Sa'][dayOfWeek]})`);
                updateProgress(completed, total, `${completed}/${total} (${failed} Fehler)`);
                setTimeout(() => processNext(index + 1), 150);
                return;
            }

            const hours = calculateHours(times.start, times.end);
            
            performApiAddWorktime(dateStr, times.start, times.end, hours, note)
                .then(() => {
                    completed++;
                    updateProgress(completed, total, `${completed}/${total} Tage eingetragen...`);
                    setTimeout(() => processNext(index + 1), 150);
                })
                .catch((err) => {
                    completed++;
                    failed++;
                    log(`⚠ Fehler bei ${dateStr}: ${err.message}`);
                    updateProgress(completed, total, `${completed}/${total} (${failed} Fehler)`);
                    setTimeout(() => processNext(index + 1), 150);
                });
        };

        processNext(0);
    }

    // ==================== DAY DETAIL ====================

    function showDayDetail(date) {
        const dateStr = formatDate(date);
        currentShowingDetailDate = dateStr; // Speichere für Schnell-Add
        const data = workingData[dateStr];

        document.getElementById('day-detail-date').textContent = formatDateLongWithDay(date);

        let content = '';

        if (!data || !data.entries || data.entries.length === 0) {
            content = '<p style="text-align: center; color: #757575; padding: 20px;">Keine Einträge für diesen Tag</p>';
        } else {
            data.entries.forEach(entry => {
                const hours = entry.duration ? (entry.duration / 3600) : 0;
                const start = entry.start.substring(11, 16);
                const end = entry.end.substring(11, 16);
                
                content += `
                    <div style="padding: 12px; background: #f5f5f5; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <span style="color: #757575; font-size: 13px; font-weight: 600;">Arbeitszeit</span>
                                <span style="font-weight: 600;">${Math.round(hours * 4) / 4}h</span>
                            </div>
                            <div style="display: flex; font-size: 13px; gap: 16px;">
                                <div><span style="color: #757575;">Von:</span> <strong>${start}</strong></div>
                                <div><span style="color: #757575;">Bis:</span> <strong>${end}</strong></div>
                            </div>
                        </div>
                        <button class="btn-secondary edit-entry-btn" style="padding: 6px 12px; font-size: 12px; white-space: nowrap;" data-entry-id="${entry.id}" data-date="${dateStr}">✏️ Bearbeiten</button>
                    </div>
                `;
            });
        }

        document.getElementById('day-detail-content').innerHTML = content;
        
        // Event-Listener DIREKT an Edit-Buttons angehängt (zuverlässiger als Event Delegation)
        const editBtns = document.querySelectorAll('.edit-entry-btn');
        log(`[showDayDetail] Hänge ${editBtns.length} Edit-Button-Listener an`);
        
        editBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const entryIdStr = btn.dataset.entryId;
                const entryId = parseInt(entryIdStr);
                const dateStr = btn.dataset.date;
                log(`[showDayDetail Click] Edit-Button geklickt! entryId=${entryId} (raw="${entryIdStr}"), dateStr=${dateStr}`);
                openEditModal(entryId, dateStr);
            });
        });
        
        document.getElementById('day-detail-modal').classList.remove('hidden');
    }

    function closeDayDetailModal() {
        document.getElementById('day-detail-modal').classList.add('hidden');
    }

    // ==================== EDIT TIME ====================

    let currentEditingEntryId = null;
    let currentEditingDateStr = null;

    function openEditModal(entryId, dateStr) {
        log(`[openEditModal] START - entryId=${entryId}, dateStr=${dateStr}, typeof entryId=${typeof entryId}`);
        
        const dayData = workingData[dateStr];
        
        if (!dayData) {
            showNotification('Tag nicht gefunden', 'error');
            log(`✗ Day nicht in workingData: ${dateStr}`);
            return;
        }
        
        log(`[openEditModal] dayData.entries=${dayData.entries?.length || 0}, entryId=${entryId}`);
        
        // Vergleiche als String um Type-Probleme zu vermeiden
        const entry = dayData.entries?.find(e => String(e.id) === String(entryId));
        
        if (!entry) {
            showNotification('Eintrag nicht gefunden', 'error');
            log(`✗ Entry nicht gefunden: ID=${entryId}, DateStr=${dateStr}, Available IDs=${dayData.entries?.map(e => `${e.id}(${typeof e.id})`).join(', ')}`);
            return;
        }

        currentEditingEntryId = entryId;
        currentEditingDateStr = dateStr;
        const start = entry.start.substring(11, 16);
        const end = entry.end.substring(11, 16);

        log(`[openEditModal] GESETZT: currentEditingEntryId=${currentEditingEntryId}, currentEditingDateStr=${currentEditingDateStr}`);
        
        document.getElementById('edit-date').value = dateStr;
        document.getElementById('edit-start-time').value = start;
        document.getElementById('edit-end-time').value = end;
        document.getElementById('edit-note').value = entry.description || '';
        document.getElementById('edit-time-error').classList.add('hidden');
        document.getElementById('edit-time-modal').classList.remove('hidden');
        log(`✓ Edit-Modal geöffnet für Entry ${entryId} am ${dateStr}`);
    }

    function closeEditModal() {
        log(`[closeEditModal] Schließe Modal. Vor dem Schließen: currentEditingEntryId=${currentEditingEntryId}, currentEditingDateStr=${currentEditingDateStr}`);
        currentEditingEntryId = null;
        currentEditingDateStr = null;
        document.getElementById('edit-time-modal').classList.add('hidden');
        log(`[closeEditModal] Modal geschlossen, Variablen gelöscht`);
    }

    async function submitEditTime() {
        log(`[submitEditTime] Starte Update mit entryId=${currentEditingEntryId}, dateStr=${currentEditingDateStr}`);
        
        if (!currentEditingEntryId) {
            log('✗ Fehler: currentEditingEntryId ist nicht gesetzt');
            showNotification('Fehler: Keine Entry-ID gesetzt', 'error');
            return;
        }
        if (!currentEditingDateStr) {
            log('✗ Fehler: currentEditingDateStr ist nicht gesetzt');
            showNotification('Fehler: Kein Datum gesetzt', 'error');
            return;
        }

        const startTime = document.getElementById('edit-start-time').value;
        const endTime = document.getElementById('edit-end-time').value;
        const errorDiv = document.getElementById('edit-time-error');

        if (!startTime || !endTime) {
            errorDiv.textContent = 'Bitte füllen Sie alle Felder aus.';
            errorDiv.classList.remove('hidden');
            return;
        }

        if (startTime >= endTime) {
            errorDiv.textContent = 'Von-Zeit muss vor Bis-Zeit liegen.';
            errorDiv.classList.remove('hidden');
            return;
        }

        // Fehler-Div zurücksetzen
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';

        // WICHTIG: Lokale Kopien der Werte machen VOR closeEditModal()!
        const entryIdToUpdate = currentEditingEntryId;
        const dateStrToUpdate = currentEditingDateStr;
        const noteToUpdate = document.getElementById('edit-note').value;

        log(`[submitEditTime] Rufe performApiUpdateWorktime mit: id=${entryIdToUpdate}, date=${dateStrToUpdate}, times=${startTime}-${endTime}`);
        
        // Schließe Modal NACH dem Speichern der Werte
        closeEditModal();
        
        // Nun die API aufrufen - entryIdToUpdate und dateStrToUpdate sind noch gültig
        try {
            await performApiUpdateWorktime(entryIdToUpdate, dateStrToUpdate, startTime, endTime, noteToUpdate);
            
            // Nach erfolgreicher Aktualisierung: day-detail Modal aktualisieren, wenn noch sichtbar
            if (!document.getElementById('day-detail-modal').classList.contains('hidden') && 
                currentShowingDetailDate === dateStrToUpdate) {
                log(`[submitEditTime] Aktualisiere day-detail Modal für ${dateStrToUpdate} nach Update`);
                const dateObj = new Date(dateStrToUpdate + 'T12:00:00');
                showDayDetail(dateObj);
            }
        } catch (err) {
            // Bei Fehler: Modal wieder öffnen und Fehlermeldung anzeigen
            document.getElementById('edit-time-modal').classList.remove('hidden');
            errorDiv.textContent = `❌ ${err.message}`;
            errorDiv.classList.remove('hidden');
            
            // Variablen wieder setzen, damit User den Edit weiterführen kann
            currentEditingEntryId = entryIdToUpdate;
            currentEditingDateStr = dateStrToUpdate;
        }
    }

    async function deleteEditTime() {
        if (!currentEditingEntryId) {
            showNotification('Fehler: Keine Entry-ID', 'error');
            return;
        }
        
        if (!confirm('Soll dieser Eintrag wirklich gelöscht werden?')) return;

        // Lokale Kopie VOR closeEditModal()
        const entryIdToDelete = currentEditingEntryId;
        const dateStrToDelete = currentEditingDateStr;

        const errorDiv = document.getElementById('edit-time-error');
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';

        closeEditModal();
        
        try {
            await performApiDeleteWorktime(entryIdToDelete);
            
            // Nach erfolgreicher Löschung: day-detail Modal aktualisieren, wenn noch sichtbar
            if (!document.getElementById('day-detail-modal').classList.contains('hidden') && 
                currentShowingDetailDate === dateStrToDelete) {
                log(`[deleteEditTime] Aktualisiere day-detail Modal für ${dateStrToDelete} nach Löschung`);
                const dateObj = new Date(dateStrToDelete + 'T12:00:00');
                showDayDetail(dateObj);
            }
        } catch (err) {
            // Bei Fehler: Modal wieder öffnen und Fehlermeldung anzeigen
            document.getElementById('edit-time-modal').classList.remove('hidden');
            errorDiv.textContent = `❌ ${err.message}`;
            errorDiv.classList.remove('hidden');
            
            // Variablen wieder setzen
            currentEditingEntryId = entryIdToDelete;
            currentEditingDateStr = dateStrToDelete;
        }
    }

    async function performApiUpdateWorktime(entryId, dateStr, startTime, endTime, note) {
        // Sicherheits-Check: Vermeide null/undefined Werte
        if (!entryId || !dateStr || !startTime || !endTime) {
            log(`✗ FEHLER in performApiUpdateWorktime: entryId=${entryId}, dateStr=${dateStr}, startTime=${startTime}, endTime=${endTime}`);
            throw new Error('Missing required parameters');
        }

        const sessionId = await getSessionId();
        if (!sessionId) throw new Error('Keine Session');

        const start = `${dateStr}T${startTime}:00.000`;
        const end = `${dateStr}T${endTime}:00.000`;

        const payload = {
            work_time_entry: {
                start: start,
                end: end,
                description: note || '',
                force_no_break: true,
                content_type: 'WORK'
            }
        };

        log(`[performApiUpdateWorktime] Starte PUT für Entry ${entryId} mit Payload:`, JSON.stringify(payload));
        log(`[performApiUpdateWorktime] URL: ${apiBaseUrl}/api/time/workentries/${entryId}`);

        const url = `${apiBaseUrl}/api/time/workentries/${entryId}`;
        
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-token': sessionId
                },
                body: JSON.stringify(payload)
            });

            log(`[performApiUpdateWorktime]  → HTTP ${response.status}`);

            if (response.ok) {
                log(`✓ Arbeitszeit erfolgreich aktualisiert!`);
                await loadWorkingData();
                renderCalendar();
                showNotification('✓ Arbeitszeit aktualisiert', 'success');
                return response.json();
            } else {
                // Echte Fehlermeldung vom Server extrahieren
                let serverErrorMsg = `HTTP ${response.status}`;
                let isClosedEntry = false;
                
                try {
                    const errorJson = response.headers.get('x-iw-error-json');
                    if (errorJson) {
                        const errorArray = JSON.parse(errorJson);
                        serverErrorMsg = errorArray[0] || serverErrorMsg;
                        isClosedEntry = serverErrorMsg.includes('closed');
                        log(`[performApiUpdateWorktime] Server-Fehler: ${serverErrorMsg}`);
                    }
                } catch (e) {
                    // Fallback auf Response-Body
                    try {
                        const responseData = await response.json();
                        serverErrorMsg = responseData.detail || responseData.title || serverErrorMsg;
                        log(`[performApiUpdateWorktime] Response-Detail: ${serverErrorMsg}`);
                    } catch (e2) {
                        log(`[performApiUpdateWorktime] Konnte Fehler nicht parsen`);
                    }
                }
                
                // Bessere Fehlermeldung für geschlossene Einträge
                let userMessage = serverErrorMsg;
                if (isClosedEntry) {
                    userMessage = `${serverErrorMsg}\n⚠️ Die API unterstützt das Bearbeiten von älteren Einträgen nicht!`;
                }
                
                throw new Error(userMessage);
            }
        } catch (err) {
            log(`✗ FEHLER in performApiUpdateWorktime: ${err.message}`);
            throw err;
        }
    }

    async function performApiDeleteWorktime(entryId) {
        const sessionId = await getSessionId();
        if (!sessionId) throw new Error('Keine Session');

        log(`[performApiDeleteWorktime] DELETE Versuch für Entry ${entryId}`);

        const url = `${apiBaseUrl}/api/time/workentries/${entryId}`;
        
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-token': sessionId
                }
            });

            log(`[performApiDeleteWorktime]  → HTTP ${response.status}`);

            if (response.ok || response.status === 204) {
                log(`✓ Arbeitszeit erfolgreich gelöscht!`);
                await loadWorkingData();
                renderCalendar();
                showNotification('✓ Eintrag gelöscht', 'success');
            } else {
                // Echte Fehlermeldung vom Server extrahieren
                let serverErrorMsg = `HTTP ${response.status}`;
                let isClosedEntry = false;
                
                try {
                    const errorJson = response.headers.get('x-iw-error-json');
                    if (errorJson) {
                        const errorArray = JSON.parse(errorJson);
                        serverErrorMsg = errorArray[0] || serverErrorMsg;
                        isClosedEntry = serverErrorMsg.includes('closed');
                        log(`[performApiDeleteWorktime] Server-Fehler: ${serverErrorMsg}`);
                    }
                } catch (e) {
                    log(`[performApiDeleteWorktime] Konnte Fehler nicht parsen`);
                }
                
                // Bessere Fehlermeldung für geschlossene Einträge
                let userMessage = serverErrorMsg;
                if (isClosedEntry) {
                    userMessage = `${serverErrorMsg}\n⚠️ Die API unterstützt das Löschen von älteren Einträgen nicht!`;
                }
                
                throw new Error(userMessage);
            }
        } catch (err) {
            log(`✗ FEHLER in performApiDeleteWorktime: ${err.message}`);
            throw err;
        }
    }

    // ==================== PROGRESS ====================

    function showProgress(title, total) {
        const container = document.getElementById('progress-container');
        document.getElementById('progress-title').textContent = title;
        document.getElementById('progress-count').textContent = `0 / ${total}`;
        document.getElementById('progress-percentage').textContent = '0%';
        document.getElementById('progress-fill').style.width = '0%';
        container.classList.remove('hidden');
    }

    function updateProgress(current, total, customText) {
        const percentage = Math.round((current / total) * 100);
        const displayText = customText || `${current} / ${total}`;
        document.getElementById('progress-count').textContent = displayText;
        document.getElementById('progress-percentage').textContent = percentage + '%';
        document.getElementById('progress-fill').style.width = percentage + '%';
    }

    function hideProgress() {
        document.getElementById('progress-container').classList.add('hidden');
    }

    function cancelOperation() {
        cancelOperationRequested = true;
    }

    // ==================== UTILITIES ====================

    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatDateLong(date) {
        const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                           'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
        return `${date.getDate()}. ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }

    function formatDateLongWithDay(date) {
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        return `${dayNames[date.getDay()]}, ${formatDateLong(date)}`;
    }

    function calculateHours(startTime, endTime) {
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        
        const start = startH + startM / 60;
        const end = endH + endM / 60;
        
        return Math.round((end - start) * 4) / 4;
    }

    function showNotification(message, type) {
        log(`[${type.toUpperCase()}] ${message}`);
    }

    // ==================== API CALLS ====================

    async function performApiAddWorktime(date, startTime, endTime, hours, note) {
        const sessionId = await getSessionId();
        if (!sessionId) throw new Error('Keine Session');

        // Format: 2026-06-30T08:00:00.000 (OHNE Timezone!)
        const start = `${date}T${startTime}:00.000`;
        const end = `${date}T${endTime}:00.000`;

        const payload = {
            work_time_entry: {
                start: start,
                end: end,
                description: note || '',
                force_no_break: true,
                content_type: 'WORK'
            }
        };

        log(`POST Versuch für ${date}: ${startTime} - ${endTime}`);
        log(`  Payload: ${JSON.stringify(payload)}`);

        // NUR ein funktionierender Endpoint: /api/time/workentries
        const url = `${apiBaseUrl}/api/time/workentries`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-token': sessionId
                },
                body: JSON.stringify(payload)
            });

            log(`  → HTTP ${response.status}`);

            if (response.ok) {
                log(`✓ Arbeitszeit erfolgreich hinzugefügt!`);
                // Neu laden um neue Einträge zu zeigen
                await loadWorkingData();
                renderCalendar();
                return response.json();
            } else {
                // Echte Fehlermeldung vom Server extrahieren
                let serverErrorMsg = `HTTP ${response.status}`;
                let isClosedEntry = false;
                
                try {
                    const errorJson = response.headers.get('x-iw-error-json');
                    if (errorJson) {
                        const errorArray = JSON.parse(errorJson);
                        serverErrorMsg = errorArray[0] || serverErrorMsg;
                        isClosedEntry = serverErrorMsg.includes('closed');
                        log(`[performApiAddWorktime] Server-Fehler: ${serverErrorMsg}`);
                    }
                } catch (e) {
                    log(`[performApiAddWorktime] Konnte Fehler nicht parsen`);
                }
                
                // Bessere Fehlermeldung für geschlossene Einträge
                let userMessage = serverErrorMsg;
                if (isClosedEntry) {
                    userMessage = `${serverErrorMsg} (Die API unterstützt das Hinzufügen zu älteren Tagen nicht!)`;
                }
                
                throw new Error(userMessage);
            }
        } catch (err) {
            log(`✗ POST-Fehler: ${err.message}`);
            throw err;
        }
    }

    // ==================== EMPFEHLUNGS-SYSTEM ====================

    function updateRecommendations() {
        // Finde Tage ohne Arbeitszeiten aber mit plan_duration > 0
        const recommendations = [];
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        for (const dateStr in workingData) {
            const dayData = workingData[dateStr];
            
            // Nur aktuelle Monat anschauen
            const [y, m] = dateStr.split('-');
            if (parseInt(y) !== year || parseInt(m) !== (month + 1)) {
                continue;
            }
            
            // Vorschlag wenn: keine Arbeitszeiten ABER plan_duration > 0 UND keine Urlaub/Feiertag
            if (dayData.hours === 0 && dayData.planHours > 0 && 
                (!dayData.type || dayData.type === 'empty')) {
                const date = new Date(dateStr + 'T12:00:00');
                const dayOfWeek = date.getDay();
                
                // Überspringe Wochenenden
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    continue;
                }
                
                recommendations.push({
                    date: dateStr,
                    hours: dayData.planHours,
                    displayDate: formatDateLongWithDay(date)
                });
            }
        }

        showRecommendations(recommendations);
    }

    function showRecommendations(recommendations) {
        const container = document.getElementById('recommendations-container');
        
        if (!container) {
            log('⚠ Recommendations container nicht gefunden');
            return;
        }

        if (recommendations.length === 0) {
            container.style.display = 'none';
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        container.style.display = 'block';
        const total = recommendations.reduce((sum, r) => sum + r.hours, 0);
        
        let html = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div>
                    <div style="font-weight: 600; font-size: 14px;">📋 ${recommendations.length} Vorschlag${recommendations.length > 1 ? 'e' : ''}</div>
                    <div style="font-size: 12px; opacity: 0.8;">Fehlende Arbeitszeiten für ${Math.round(total)} Stunden</div>
                </div>
                <button id="accept-recommendations" style="
                    background: white;
                    color: #667eea;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    font-size: 12px;
                    transition: all 0.2s;
                "
                onmouseover="this.style.background='#f0f0f0'"
                onmouseout="this.style.background='white'"
                >✓ Alle eintragen</button>
            </div>
            <div style="font-size: 12px; opacity: 0.8; max-height: 80px; overflow-y: auto;">
                ${recommendations.slice(0, 5).map(r => `<div>• ${r.displayDate}: ${r.hours}h</div>`).join('')}
                ${recommendations.length > 5 ? `<div>• ... und ${recommendations.length - 5} weitere</div>` : ''}
            </div>
        `;
        
        container.innerHTML = html;
        container.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px;
            border-radius: 8px;
            margin-top: 16px;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        
        // Attach Event Handler
        const btn = container.querySelector('#accept-recommendations');
        if (btn) {
            btn.onclick = () => acceptRecommendations(recommendations);
        }
    }

    function acceptRecommendations(recommendations) {
        if (recommendations.length === 0) return;
        
        const dates = recommendations.map(r => r.date);
        const startTime = '09:00';
        const endTime = '17:00';
        const hours = calculateHours(startTime, endTime);
        
        cancelOperationRequested = false;
        showProgress(`Empfehlung automatisch eintragen (${recommendations.length} Tage)`, dates.length);

        let completed = 0;
        let failed = 0;

        const processNext = (index) => {
            if (cancelOperationRequested || index >= dates.length) {
                if (cancelOperationRequested) {
                    hideProgress();
                    showNotification('⊘ Abgebrochen', 'warning');
                } else {
                    const status = failed > 0 
                        ? `✓ ${completed}/${dates.length} Empfehlungen eingetragen (${failed} Fehler)`
                        : `✓ ${dates.length} Empfehlungen erfolgreich eingetragen`;
                    hideProgress();
                    loadWorkingData();
                    showNotification(status, 'success');
                }
                return;
            }

            const dateStr = dates[index];
            
            performApiAddWorktime(dateStr, startTime, endTime, hours, 'Automatische Eintragung')
                .then(() => {
                    completed++;
                    updateProgress(completed, dates.length, `${completed}/${dates.length} Empfehlungen...`);
                    setTimeout(() => processNext(index + 1), 150);
                })
                .catch((err) => {
                    completed++;
                    failed++;
                    log(`⚠ Fehler bei ${dateStr}: ${err.message}`);
                    updateProgress(completed, dates.length, `${completed}/${dates.length} (${failed} Fehler)`);
                    setTimeout(() => processNext(index + 1), 150);
                });
        };

        processNext(0);
    }

})();

