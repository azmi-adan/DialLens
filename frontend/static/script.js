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
let useClientOCR = false; // Fallback to client-side OCR if backend fails

// API URL - UPDATE THIS WITH YOUR ACTUAL RENDER BACKEND URL
// After you deploy backend on Render, replace this URL
const API_URL = 'https://diallens-backend.onrender.com'; // Change this to your Render backend URL

// ==================== Splash Screen ====================
setTimeout(() => {
    splashScreen.style.opacity = '0';
    setTimeout(() => {
        splashScreen.classList.add('hidden');
        appContainer.classList.remove('hidden');
        initCamera();
        loadTesseractForFallback();
    }, 800);
}, 2000);

// ==================== Load Tesseract.js for Client-Side OCR (Fallback) ====================
function loadTesseractForFallback() {
    // Dynamically load Tesseract.js as fallback
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => {
        console.log('Tesseract.js loaded - client-side OCR available as fallback');
    };
    script.onerror = () => {
        console.warn('Tesseract.js failed to load');
    };
    document.head.appendChild(script);
}

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

// ==================== Client-Side OCR with Tesseract.js ====================
async function clientSideOCR(imageData) {
    return new Promise((resolve, reject) => {
        if (typeof Tesseract === 'undefined') {
            reject(new Error('Tesseract.js not loaded'));
            return;
        }
        
        showToast('Running OCR in browser...', 'info');
        
        // Convert base64 to image blob
        const img = new Image();
        img.onload = () => {
            Tesseract.recognize(
                img,
                'eng',
                {
                    logger: (m) => console.log(m),
                    tessjs_create_hocr: false,
                    tessjs_create_tsv: false,
                    tessjs_create_box: false,
                    tessjs_create_unlv: false,
                    tessjs_create_osd: false
                }
            ).then(({ data: { text } }) => {
                console.log('Client OCR result:', text);
                const phoneNumbers = extractPhoneNumbersFromText(text);
                resolve(phoneNumbers);
            }).catch((err) => {
                reject(err);
            });
        };
        img.onerror = () => {
            reject(new Error('Failed to load image for OCR'));
        };
        img.src = imageData;
    });
}

// ==================== Extract Phone Numbers from Text ====================
function extractPhoneNumbersFromText(text) {
    // Regex patterns for phone numbers
    const patterns = [
        /\+254\d{9}/g,           // Kenyan: +254XXXXXXXXX
        /07\d{8}/g,              // Kenyan: 07XXXXXXXX
        /01\d{8}/g,              // Kenyan: 01XXXXXXXX
        /254\d{9}/g,             // Kenyan without plus: 254XXXXXXXXX
        /\+\d{1,3}\s?\d{3}\s?\d{3}\s?\d{4}/g,  // International
        /0\d{9}/g                // Any 10-digit starting with 0
    ];
    
    let numbers = new Set();
    
    patterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            matches.forEach(match => {
                // Clean the number
                const cleaned = match.replace(/\s/g, '');
                if (cleaned.length >= 9 && cleaned.length <= 15) {
                    numbers.add(cleaned);
                }
            });
        }
    });
    
    return Array.from(numbers).sort();
}

// ==================== Send to Backend ====================
async function sendImageForOCR(imageData) {
    showLoading(true);
    
    // Try backend first
    try {
        const url = `${API_URL}/scan`;
        console.log('Calling backend OCR at:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: imageData })
        });
        
        const data = await response.json();
        
        if (data.success && data.numbers && data.numbers.length > 0) {
            displayResults(data.numbers);
            saveToHistory(data.numbers);
            showToast(`Found ${data.count} phone number(s)!`, 'success');
            showLoading(false);
            return data.numbers;
        } else if (data.success && data.numbers && data.numbers.length === 0) {
            // No numbers found by backend, try client-side as fallback
            showToast('Backend found nothing, trying client-side OCR...', 'info');
            const clientNumbers = await clientSideOCR(imageData);
            if (clientNumbers.length > 0) {
                displayResults(clientNumbers);
                saveToHistory(clientNumbers);
                showToast(`Found ${clientNumbers.length} number(s) via client OCR!`, 'success');
                showLoading(false);
                return clientNumbers;
            } else {
                displayEmptyResults('No phone numbers detected. Try a clearer image.');
                showToast('No numbers found. Try a clearer image.', 'warning');
                showLoading(false);
                return [];
            }
        } else {
            // Backend error, try client-side
            console.log('Backend error, trying client-side OCR...');
            const clientNumbers = await clientSideOCR(imageData);
            if (clientNumbers.length > 0) {
                displayResults(clientNumbers);
                saveToHistory(clientNumbers);
                showToast(`Found ${clientNumbers.length} number(s) via browser OCR!`, 'success');
                showLoading(false);
                return clientNumbers;
            } else {
                throw new Error(data.error || 'Scan failed');
            }
        }
    } catch (error) {
        console.error('Backend OCR error:', error);
        
        // Try client-side OCR as fallback
        try {
            showToast('Backend unavailable, using browser OCR...', 'info');
            const clientNumbers = await clientSideOCR(imageData);
            if (clientNumbers.length > 0) {
                displayResults(clientNumbers);
                saveToHistory(clientNumbers);
                showToast(`Found ${clientNumbers.length} number(s) via browser OCR!`, 'success');
                showLoading(false);
                return clientNumbers;
            } else {
                displayEmptyResults('No phone numbers detected. Backend unavailable, and browser OCR found nothing.');
                showToast('OCR failed. Please try again.', 'error');
                showLoading(false);
                return [];
            }
        } catch (clientError) {
            console.error('Client OCR error:', clientError);
            displayEmptyResults('OCR failed. Please check your connection and try again.');
            showToast('OCR failed. Backend unavailable and browser OCR failed.', 'error');
            showLoading(false);
            return [];
        }
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
    }, 3000);
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