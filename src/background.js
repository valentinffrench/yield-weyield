// Service worker : un clic sur l'icône de l'extension ouvre / ferme le panneau latéral.
const arm = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);
arm();
