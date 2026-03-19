// Background Script für AdminPlus Extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'closeTab') {
        // Schließe den Tab, von dem die Nachricht kam
        chrome.tabs.remove(sender.tab.id);
        sendResponse({ success: true });
    }
});
