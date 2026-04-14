// static/script.js - Frontend Logic for DialLens
// DOM Elements
const splashScreen = document.getElementById('splash-screen');
const appContainer = document.getElementById('app-container');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('capture-btn');
const resultsContainer = document.getElementById('results-container');
const historyContainer = document.getElementById('history-container');
const cameraStatus = document.getElementById('camera-status');
const realtimeToggle = document.getElementById('realtime-toggle');
const themeToggle = document.getElementById('theme-toggle');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const clearHistoryAllBtn = document.getElementById('clear-history-all-btn');
const copyAllBtn = document.getElementById('copy-all-btn');
const loadingToast = document.getElementById('loading-toast');
const messageToast = document.getElementById('message-toast');

// State variables
let stream = null;
let realtimeMode = false;
let realtimeInterval = null;
let currentDetectedNumbers = [];

// ==================== Splash Screen ====================
setTimeout(() => {
    splashScreen.style.opacity = '0';
    setTimeout(() => {
        splashScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        initCamera();
    }, 800);
}, 2000);

// ==================== Theme Management ====================
function initTheme() {
    const savedTheme = localStorage.getItem('diallens-theme');
    if (savedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    }
}

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('diallens-theme', 'light');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        showToast('Light mode activated', 'info');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('diallens-theme', 'dark');
        themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        showToast('Dark mode restored', 'info');
    }
});

// ==================== Camera Initialization ====================
async function initCamera() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        await video.play();
        cameraStatus.innerHTML = '<i class="fas fa-check-circle"></i> Camera ready';
        cameraStatus.style.color = 'var(--success)';
    } catch (error) {
        console.error('Camera error:', error);
        cameraStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Unable to access camera. Please check permissions.';
        cameraStatus.style.color = 'var(--error)';
        captureBtn.disabled = true;
    }
}

// ==================== Capture Frame ====================
function captureFrame() {
    if (!video.videoWidth || !video.videoHeight) {
        showToast('Camera not ready', 'error');
        return null;
    }
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.8);
}

// ==================== Send to Backend ====================
async function sendImageForOCR(imageData) {
    showLoading(true);
    
    try {
        const response = await fetch('/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: imageData })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (data.numbers && data.numbers.length > 0) {
                displayResults(data.numbers);
                saveToHistory(data.numbers);
                showToast(`Found ${data.count} phone number(s)!`, 'success');
                return data.numbers;
            } else {
                displayEmptyResults(data.message || 'No phone numbers detected');
                showToast('No numbers found. Try a clearer image.', 'warning');
                return [];
            }
        } else {
            throw new Error(data.error || 'Scan failed');
        }
    } catch (error) {
        console.error('OCR error:', error);
        showToast('Error processing image: ' + error.message, 'error');
        return [];
    } finally {
        showLoading(false);
    }
}

// ==================== Display Results ====================
function displayResults(numbers) {
    currentDetectedNumbers = numbers;
    
    if (!numbers || numbers.length === 0) {
        displayEmptyResults();
        return;
    }
    
    resultsContainer.innerHTML = '';
    numbers.forEach(number => {
        const numberDiv = document.createElement('div');
        numberDiv.className = 'number-item';
        numberDiv.innerHTML = `
            <a href="tel:${number}" class="number-link">
                <i class="fas fa-phone"></i> ${number}
            </a>
            <div class="number-actions">
                <button class="icon-btn copy-number" data-number="${number}" title="Copy to clipboard">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="icon-btn save-number" data-number="${number}" title="Save to history">
                    <i class="fas fa-save"></i>
                </button>
            </div>
        `;
        resultsContainer.appendChild(numberDiv);
    });
    
    // Add event listeners for copy/save buttons
    document.querySelectorAll('.copy-number').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const number = btn.getAttribute('data-number');
            copyToClipboard(number);
        });
    });
    
    document.querySelectorAll('.save-number').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const number = btn.getAttribute('data-number');
            saveSingleNumber(number);
            showToast('Saved to history', 'success');
        });
    });
    
    const footer = document.getElementById('results-footer');
    if (footer) footer.style.display = 'flex';
}

function displayEmptyResults(message = 'No phone numbers detected. Try again with a clearer image.') {
    resultsContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-search"></i>
            <p>${message}</p>
        </div>
    `;
    const footer = document.getElementById('results-footer');
    if (footer) footer.style.display = 'none';
}

// ==================== History Management (localStorage) ====================
function saveToHistory(numbers) {
    if (!numbers || numbers.length === 0) return;
    
    let history = getHistory();
    const timestamp = new Date().toISOString();
    
    numbers.forEach(number => {
        // Avoid duplicates in recent history (check last 10)
        const exists = history.some(item => item.number === number && 
            (Date.now() - new Date(item.timestamp).getTime() < 60000));
        
        if (!exists) {
            history.unshift({
                number: number,
                timestamp: timestamp,
                id: Date.now() + Math.random()
            });
        }
    });
    
    // Keep only last 20 items
    history = history.slice(0, 20);
    localStorage.setItem('diallens_history', JSON.stringify(history));
    renderHistory();
}

function saveSingleNumber(number) {
    let history = getHistory();
    history.unshift({
        number: number,
        timestamp: new Date().toISOString(),
        id: Date.now() + Math.random()
    });
    history = history.slice(0, 20);
    localStorage.setItem('diallens_history', JSON.stringify(history));
    renderHistory();
}

function getHistory() {
    const stored = localStorage.getItem('diallens_history');
    return stored ? JSON.parse(stored) : [];
}

function renderHistory() {
    const history = getHistory();
    
    if (!historyContainer) return;
    
    if (history.length === 0) {
        historyContainer.innerHTML = `
            <div class="empty-state small">
                <i class="fas fa-database"></i>
                <p>No saved scans yet</p>
            </div>
        `;
        return;
    }
    
    historyContainer.innerHTML = '';
    history.forEach(item => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const histDiv = document.createElement('div');
        histDiv.className = 'history-item';
        histDiv.innerHTML = `
            <div class="history-number">
                <i class="fas fa-phone-alt"></i> ${item.number}
            </div>
            <div class="history-meta">
                <small>${timeStr}</small>
                <button class="icon-btn copy-history" data-number="${item.number}" title="Copy">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="icon-btn delete-history" data-id="${item.id}" title="Delete">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        historyContainer.appendChild(histDiv);
    });
    
    // Add event listeners for history items
    document.querySelectorAll('.copy-history').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const number = btn.getAttribute('data-number');
            copyToClipboard(number);
        });
    });
    
    document.querySelectorAll('.delete-history').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'));
            deleteHistoryItem(id);
        });
    });
}

function deleteHistoryItem(id) {
    let history = getHistory();
    history = history.filter(item => item.id !== id);
    localStorage.setItem('diallens_history', JSON.stringify(history));
    renderHistory();
    showToast('Item removed', 'info');
}

function clearAllHistory() {
    if (confirm('Clear all scan history?')) {
        localStorage.removeItem('diallens_history');
        renderHistory();
        showToast('History cleared', 'info');
    }
}

// ==================== Copy to Clipboard ====================
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(`Copied: ${text}`, 'success');
    } catch (err) {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`Copied: ${text}`, 'success');
    }
}

function copyAllNumbers() {
    if (currentDetectedNumbers.length === 0) {
        showToast('No numbers to copy', 'warning');
        return;
    }
    const allNumbers = currentDetectedNumbers.join('\n');
    copyToClipboard(allNumbers);
}

// ==================== Real-time Scanning ====================
function startRealtimeScan() {
    if (realtimeInterval) clearInterval(realtimeInterval);
    realtimeInterval = setInterval(async () => {
        if (realtimeMode && video.videoWidth > 0) {
            const imageData = captureFrame();
            if (imageData) {
                await sendImageForOCR(imageData);
            }
        }
    }, 2000); // Scan every 2 seconds
}

function stopRealtimeScan() {
    if (realtimeInterval) {
        clearInterval(realtimeInterval);
        realtimeInterval = null;
    }
}

realtimeToggle.addEventListener('change', (e) => {
    realtimeMode = e.target.checked;
    if (realtimeMode) {
        startRealtimeScan();
        showToast('Real-time scanning activated', 'info');
    } else {
        stopRealtimeScan();
        showToast('Real-time scanning deactivated', 'info');
    }
});

// ==================== Manual Capture ====================
captureBtn.addEventListener('click', async () => {
    if (!video.videoWidth) {
        showToast('Camera not ready', 'error');
        return;
    }
    
    const imageData = captureFrame();
    if (imageData) {
        await sendImageForOCR(imageData);
    }
});

// ==================== UI Helpers ====================
function showLoading(show) {
    if (show) {
        loadingToast.classList.remove('hidden');
    } else {
        loadingToast.classList.add('hidden');
    }
}

function showToast(message, type = 'info') {
    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const icon = iconMap[type] || 'fa-info-circle';
    const messageIcon = document.getElementById('message-icon');
    const messageText = document.getElementById('message-text');
    
    if (messageIcon) messageIcon.className = `fas ${icon}`;
    if (messageText) messageText.textContent = message;
    
    messageToast.classList.remove('hidden');
    
    setTimeout(() => {
        messageToast.classList.add('hidden');
    }, 2500);
}

// ==================== Event Listeners ====================
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        if (currentDetectedNumbers.length > 0) {
            if (confirm('Clear current results?')) {
                displayEmptyResults();
                currentDetectedNumbers = [];
                showToast('Results cleared', 'info');
            }
        }
    });
}

if (clearHistoryAllBtn) {
    clearHistoryAllBtn.addEventListener('click', clearAllHistory);
}

if (copyAllBtn) {
    copyAllBtn.addEventListener('click', copyAllNumbers);
}

// ==================== Cleanup on Page Unload ====================
window.addEventListener('beforeunload', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (realtimeInterval) {
        clearInterval(realtimeInterval);
    }
});

// ==================== Initialize ====================
initTheme();
renderHistory();