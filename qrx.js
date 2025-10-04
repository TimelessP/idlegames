// QRX - QR Code File Transfer System
// Modular, secure, device-to-device file transfer via QR codes

class QRXProtocol {
  static MESSAGE_TYPES = {
    HANDSHAKE: 'handshake',
    HANDSHAKE_ACK: 'handshake_ack', 
    FILE_OFFER: 'file_offer',
    FILE_ACCEPT: 'file_accept',
    CHUNK_REQUEST: 'chunk_request',
    CHUNK_DATA: 'chunk_data',
    CHUNK_ACK: 'chunk_ack',
    TRANSFER_COMPLETE: 'transfer_complete',
    ERROR: 'error',
    SESSION_END: 'session_end'
  };

  static ERROR_CODES = {
    INVALID_MESSAGE: 'invalid_message',
    CHECKSUM_FAILED: 'checksum_failed', 
    FILE_TOO_LARGE: 'file_too_large',
    CHUNK_MISSING: 'chunk_missing',
    SESSION_EXPIRED: 'session_expired'
  };

  static MAX_CHUNK_SIZE = 1024; // Keep chunks small for reliable QR codes
  static MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
  static QR_ERROR_CORRECTION = 'M'; // Medium error correction for chunky codes
}

class QRGenerator {
  static async generateDataURL(text, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        console.log('QRGenerator: Starting generation process');
        console.log('QRGenerator: QRious type check:', typeof QRious);
        
        if (typeof QRious === 'undefined') {
          console.error('QRGenerator: QRious library not loaded');
          reject(new Error('QRious library not loaded'));
          return;
        }

        console.log('QRGenerator: Creating canvas element');
        const canvas = document.createElement('canvas');
        
        console.log('QRGenerator: Initializing QRious with options:', { text: text.substring(0, 50) + '...', size: options.size || 200 });
        const qr = new QRious({
          element: canvas,
          value: text,
          size: options.size || 200,
          level: 'M'
        });

        console.log('QRGenerator: Getting data URL');
        const dataURL = qr.toDataURL();
        console.log('QRGenerator: Success, data URL prefix:', dataURL.substring(0, 50));
        
        resolve(dataURL);
      } catch (error) {
        console.error('QRGenerator: Error during generation:', error);
        reject(error);
      }
    });
  }
  
  static generateDataDisplay(data, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    
    // Black border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size-2, size-2);
    
    // Title
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QRX DATA', size/2, 30);
    
    // Data content in a scrollable format
    ctx.font = '12px monospace';
    const maxWidth = size - 20;
    const lineHeight = 16;
    let y = 60;
    
    // Word wrap the data
    const words = data.split(' ');
    let line = '';
    
    for (let n = 0; n < words.length && y < size - 40; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line.length > 0) {
        ctx.fillText(line.trim(), size/2, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    
    if (line.trim().length > 0 && y < size - 20) {
      ctx.fillText(line.trim(), size/2, y);
    }
    
    // Instructions
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#666666';
    ctx.fillText('Manual entry required', size/2, size - 20);
    ctx.fillText('(No QR scanner available)', size/2, size - 8);
    
    return canvas.toDataURL();
  }
  
  static simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

class QRScanner {
  constructor() {
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.scanning = false;
    this.onQRDetected = null;
    this.lastDetectedData = null;
    this.lastDetectionTime = 0;
    this.detectionCooldown = 2000; // 2 seconds between same QR detections
    this.preferredFacingMode = null; // User's camera preference
  }

  async startCamera(facingMode = null) {
    // Check if navigator.mediaDevices is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('Camera API not available - requires HTTPS or localhost');
      return false;
    }

    // Use specified facing mode or fall back to user preference or auto-detection
    const requestedFacingMode = facingMode || this.preferredFacingMode || this.getDefaultFacingMode();
    console.log('� Starting camera with facing mode:', requestedFacingMode);

    try {
      let constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      // Add facing mode constraint if specified
      if (requestedFacingMode) {
        // Use 'ideal' instead of 'exact' to be less strict - allows fallback
        constraints.video.facingMode = { ideal: requestedFacingMode };
      }

      console.log('📷 Camera constraints:', constraints);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      this.video = document.getElementById('video');
      this.video.srcObject = this.stream;
      
      // Store the successful facing mode
      this.currentFacingMode = requestedFacingMode;
      
      // Adjust overlay when video loads
      this.video.addEventListener('loadedmetadata', () => {
        this.adjustOverlayPosition();
      });
      
      // Start scanning loop
      this.scanning = true;
      this.scanLoop();
      
      console.log('✅ Camera started successfully with', requestedFacingMode || 'default', 'camera');
      return true;
      
    } catch (error) {
      console.error('❌ Camera request failed:', error);
      
      // Try fallback strategies
      return await this.tryFallbackCameras(requestedFacingMode);
    }
  }

  getDefaultFacingMode() {
    // Detect if we're on mobile to suggest default camera
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return isMobile ? 'environment' : null; // Back camera on mobile, any on desktop
  }

  async tryFallbackCameras(originalRequest) {
    console.log('🔄 Trying fallback camera options...');
    
    const fallbackModes = [];
    
    if (originalRequest === 'environment') {
      fallbackModes.push('user', null);
    } else if (originalRequest === 'user') {
      fallbackModes.push('environment', null);
    } else {
      fallbackModes.push('environment', 'user', null);
    }

    for (const mode of fallbackModes) {
      try {
        console.log('� Trying fallback:', mode || 'any camera');
        
        let constraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        };

        if (mode) {
          constraints.video.facingMode = { ideal: mode }; // Use ideal instead of exact
        }

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        this.video = document.getElementById('video');
        this.video.srcObject = this.stream;
        this.currentFacingMode = mode;
        
        // Adjust overlay when video loads
        this.video.addEventListener('loadedmetadata', () => {
          this.adjustOverlayPosition();
        });
        
        this.scanning = true;
        this.scanLoop();
        
        console.log('✅ Camera started with fallback:', mode || 'default');
        return true;
        
      } catch (error) {
        console.log('❌ Fallback failed for', mode || 'default camera', ':', error.message);
        continue;
      }
    }

    console.error('❌ All camera options failed');
    return false;
  }

  stopCamera() {
    this.scanning = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  adjustOverlayPosition() {
    const overlay = document.querySelector('.camera-overlay');
    if (!overlay || !this.video) return;

    const videoRect = this.video.getBoundingClientRect();
    const containerRect = this.video.parentElement.getBoundingClientRect();
    
    // Calculate the actual video content area within the container
    const videoAspect = this.video.videoWidth / this.video.videoHeight;
    const containerAspect = containerRect.width / containerRect.height;
    
    let actualVideoWidth, actualVideoHeight, offsetX = 0, offsetY = 0;
    
    if (videoAspect > containerAspect) {
      // Video is wider - black bars on top/bottom
      actualVideoWidth = containerRect.width;
      actualVideoHeight = containerRect.width / videoAspect;
      offsetY = (containerRect.height - actualVideoHeight) / 2;
    } else {
      // Video is taller - black bars on sides
      actualVideoHeight = containerRect.height;
      actualVideoWidth = containerRect.height * videoAspect;
      offsetX = (containerRect.width - actualVideoWidth) / 2;
    }
    
    // Position overlay in the center of the actual video content
    overlay.style.left = `${offsetX + actualVideoWidth / 2 - 100}px`; // 100px = half overlay width
    overlay.style.top = `${offsetY + actualVideoHeight / 2 - 100}px`; // 100px = half overlay height
    overlay.style.transform = 'none'; // Remove centering transform
  }

  scanLoop() {
    if (!this.scanning || !this.video) return;
    
    requestAnimationFrame(() => {
      const result = this.detectQR();
      if (result && this.onQRDetected) {
        const currentTime = Date.now();
        
        // Prevent duplicate detections of the same data
        if (result.data !== this.lastDetectedData || 
            currentTime - this.lastDetectionTime > this.detectionCooldown) {
          
          console.log('📷 QR Scanner - New detection:', result.data.substring(0, 50) + '...');
          this.lastDetectedData = result.data;
          this.lastDetectionTime = currentTime;
          this.onQRDetected(result.data);
        }
      }
      
      if (this.scanning) {
        this.scanLoop();
      }
    });
  }

  detectQR() {
    if (!this.video || this.video.readyState !== 4) return null;
    
    try {
      // Create canvas to capture video frame
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = this.video.videoWidth;
      canvas.height = this.video.videoHeight;
      
      if (canvas.width === 0 || canvas.height === 0) return null;
      
      // Draw current video frame
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
      
      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Use jsQR to detect QR codes if available
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        return code;
      } else {
        // Fallback: no real QR detection without library
        // This would need manual QR code input or different approach
        return null;
      }
    } catch (error) {
      // Silent fail - QR detection errors are common and expected
      return null;
    }
  }
}

class FileChunker {
  static chunkFile(file) {
    const chunks = [];
    const chunkSize = QRXProtocol.MAX_CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      let currentChunk = 0;
      
      const readNextChunk = () => {
        const start = currentChunk * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const blob = file.slice(start, end);
        
        reader.onload = (e) => {
          const arrayBuffer = e.target.result;
          const data = new Uint8Array(arrayBuffer);
          
          chunks.push({
            id: currentChunk,
            data: Array.from(data),
            checksum: this.calculateChecksum(data)
          });
          
          currentChunk++;
          if (currentChunk < totalChunks) {
            readNextChunk();
          } else {
            resolve({
              filename: file.name,
              size: file.size,
              type: file.type,
              totalChunks,
              chunks,
              fileChecksum: this.calculateFileChecksum(chunks)
            });
          }
        };
        
        reader.readAsArrayBuffer(blob);
      };
      
      readNextChunk();
    });
  }

  static calculateChecksum(data) {
    // Simple checksum - would use proper hash in production
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum = (sum + data[i]) % 65536;
    }
    return sum.toString(16);
  }

  static calculateFileChecksum(chunks) {
    let combined = '';
    chunks.forEach(chunk => combined += chunk.checksum);
    return this.calculateChecksum(new TextEncoder().encode(combined));
  }

  static reconstructFile(chunks, metadata) {
    // Sort chunks by ID
    chunks.sort((a, b) => a.id - b.id);
    
    // Verify all chunks present
    for (let i = 0; i < metadata.totalChunks; i++) {
      if (!chunks.find(c => c.id === i)) {
        throw new Error(`Missing chunk ${i}`);
      }
    }
    
    // Combine data
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    chunks.forEach(chunk => {
      combined.set(chunk.data, offset);
      offset += chunk.data.length;
    });
    
    // Verify integrity
    const reconstructedChecksum = this.calculateFileChecksum(chunks);
    if (reconstructedChecksum !== metadata.fileChecksum) {
      throw new Error('File integrity check failed');
    }
    
    return new Blob([combined], { type: metadata.type });
  }
}

class QRXSession {
  constructor() {
    this.sessionId = null;
    this.state = 'idle';
    this.isInitiator = false;
    this.peerCapabilities = null;
    this.currentFile = null;
    this.transferData = null;
    this.receivedChunks = new Map();
    this.onStateChange = null;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  generateSessionId() {
    return 'qrx-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2);
  }

  startSession() {
    this.sessionId = this.generateSessionId();
    this.state = 'waiting_for_peer';
    this.isInitiator = true;
    this.notifyStateChange();
    
    // Send handshake QR
    const handshake = {
      type: QRXProtocol.MESSAGE_TYPES.HANDSHAKE,
      sessionId: this.sessionId,
      capabilities: ['file_transfer'],
      timestamp: Date.now()
    };
    
    return this.createMessage(handshake);
  }

  handleMessage(message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case QRXProtocol.MESSAGE_TYPES.HANDSHAKE:
          return this.handleHandshake(data);
        
        case QRXProtocol.MESSAGE_TYPES.HANDSHAKE_ACK:
          return this.handleHandshakeAck(data);
          
        case QRXProtocol.MESSAGE_TYPES.FILE_OFFER:
          return this.handleFileOffer(data);
          
        case QRXProtocol.MESSAGE_TYPES.FILE_ACCEPT:
          return this.handleFileAccept(data);
          
        case QRXProtocol.MESSAGE_TYPES.CHUNK_REQUEST:
          return this.handleChunkRequest(data);
          
        case QRXProtocol.MESSAGE_TYPES.CHUNK_DATA:
          return this.handleChunkData(data);
          
        case QRXProtocol.MESSAGE_TYPES.CHUNK_ACK:
          return this.handleChunkAck(data);
          
        default:
          throw new Error(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      this.notifyError('Invalid message received: ' + error.message);
      return null;
    }
  }

  handleHandshake(data) {
    console.log('🤝 Processing handshake. Current state:', this.state);
    console.log('🤝 Received sessionId:', data.sessionId);
    
    if (this.state !== 'idle') {
      console.warn('⚠️ Handshake received but not in idle state. Current state:', this.state);
      this.notifyError(`Cannot accept connection - already in ${this.state} state`);
      return null;
    }
    
    // Validate handshake data
    if (!data.sessionId || !data.capabilities) {
      console.error('❌ Invalid handshake data');
      this.notifyError('Invalid connection request received');
      return null;
    }
    
    this.sessionId = data.sessionId;
    this.state = 'connected';
    this.peerCapabilities = data.capabilities;
    this.isInitiator = false;
    this.notifyStateChange();
    
    console.log('✅ Handshake accepted, sending acknowledgment');
    
    // Send acknowledgment
    const ack = {
      type: QRXProtocol.MESSAGE_TYPES.HANDSHAKE_ACK,
      sessionId: this.sessionId,
      capabilities: ['file_transfer'],
      timestamp: Date.now()
    };
    
    return this.createMessage(ack);
  }

  handleHandshakeAck(data) {
    if (this.state !== 'waiting_for_peer' || data.sessionId !== this.sessionId) return null;
    
    this.state = 'connected';
    this.peerCapabilities = data.capabilities;
    this.notifyStateChange();
    
    return null; // No response needed
  }

  handleFileOffer(data) {
    if (this.state !== 'connected' || data.sessionId !== this.sessionId) return null;
    
    // Store the file offer details
    this.pendingFileOffer = data;
    this.state = 'file_offered';
    this.notifyStateChange();
    
    // For now, auto-accept files (in production, would show user prompt)
    const accept = {
      type: QRXProtocol.MESSAGE_TYPES.FILE_ACCEPT,
      sessionId: this.sessionId,
      accepted: true,
      timestamp: Date.now()
    };
    
    return this.createMessage(accept);
  }

  handleFileAccept(data) {
    if (this.state !== 'offering_file' || data.sessionId !== this.sessionId) return null;
    
    if (data.accepted) {
      this.state = 'transferring';
      this.notifyStateChange();
      this.notifyProgress(0, this.transferData.totalChunks, 'Starting file transfer...');
      
      // Start with first chunk
      const firstChunk = {
        type: QRXProtocol.MESSAGE_TYPES.CHUNK_DATA,
        sessionId: this.sessionId,
        chunkId: 0,
        data: this.transferData.chunks[0].data,
        checksum: this.transferData.chunks[0].checksum,
        timestamp: Date.now()
      };
      
      return this.createMessage(firstChunk);
    } else {
      this.state = 'connected';
      this.notifyStateChange();
      this.notifyError('File transfer was declined by peer');
      return null;
    }
  }

  handleChunkRequest(data) {
    // Implementation for chunk requests (would handle retries)
    return null;
  }

  handleChunkData(data) {
    // Implementation for receiving chunk data
    return null;
  }

  handleChunkAck(data) {
    // Implementation for chunk acknowledgments  
    return null;
  }

  async offerFile(file) {
    if (this.state !== 'connected') {
      throw new Error('No active session');
    }
    
    if (file.size > QRXProtocol.MAX_FILE_SIZE) {
      throw new Error('File too large');
    }
    
    this.currentFile = file;
    this.transferData = await FileChunker.chunkFile(file);
    this.state = 'offering_file';
    this.notifyStateChange();
    
    const offer = {
      type: QRXProtocol.MESSAGE_TYPES.FILE_OFFER,
      sessionId: this.sessionId,
      filename: file.name,
      size: file.size,
      type: file.type,
      totalChunks: this.transferData.totalChunks,
      checksum: this.transferData.fileChecksum,
      timestamp: Date.now()
    };
    
    return this.createMessage(offer);
  }

  createMessage(data) {
    // Compress message for QR codes
    return JSON.stringify(data);
  }

  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.state, this.sessionId);
    }
  }

  notifyProgress(current, total, message) {
    if (this.onProgress) {
      this.onProgress(current, total, message);
    }
  }

  notifyComplete(file) {
    if (this.onComplete) {
      this.onComplete(file);
    }
  }

  notifyError(message) {
    if (this.onError) {
      this.onError(message);
    }
  }
}

// Main Application
class QRXApp {
  constructor() {
    this.session = new QRXSession();
    this.scanner = new QRScanner();
    this.currentQR = null;
    
    this.initializeUI();
    this.setupEventHandlers();
  }

  initializeUI() {
    this.elements = {
      qrDisplay: document.getElementById('qrDisplay'),
      video: document.getElementById('video'),
      startSession: document.getElementById('startSession'),
      resetSession: document.getElementById('resetSession'),
      debugLibs: document.getElementById('debugLibs'),
      startCamera: document.getElementById('startCamera'),
      useBackCamera: document.getElementById('useBackCamera'),
      useFrontCamera: document.getElementById('useFrontCamera'),
      stopCamera: document.getElementById('stopCamera'),
      manualInput: document.getElementById('manualInput'),
      processManual: document.getElementById('processManual'),
      fileDrop: document.getElementById('fileDrop'),
      fileInput: document.getElementById('fileInput'),
      sessionInfo: document.getElementById('sessionInfo'),
      sessionId: document.getElementById('sessionId'),
      sessionState: document.getElementById('sessionState'),
      peerInfo: document.getElementById('peerInfo'),
      progressContainer: document.getElementById('progressContainer'),
      progressFill: document.getElementById('progressFill'),
      progressText: document.getElementById('progressText'),
      status: document.getElementById('status')
    };
    
    this.showStatus('Ready to transfer files securely between devices');
  }

  setupEventHandlers() {
    // Session management
    this.session.onStateChange = (state, sessionId) => {
      this.elements.sessionState.textContent = state;
      this.elements.sessionId.textContent = sessionId || 'Not Connected';
      
      // Update UI based on session state
      if (state === 'idle') {
        this.elements.startSession.textContent = 'Start New Session';
        this.elements.startSession.disabled = false;
        this.elements.sessionInfo.classList.add('hidden');
      } else if (state === 'waiting_for_peer') {
        this.elements.startSession.textContent = 'Waiting for Connection';
        this.elements.startSession.disabled = true;
        this.showStatus('📱 Waiting for other device to scan QR code. Do not start a session on the other device!', 'info');
      } else if (state === 'connected') {
        this.elements.startSession.textContent = 'Connected';
        this.elements.startSession.disabled = true;
        this.elements.sessionInfo.classList.remove('hidden');
        this.showStatus('✅ Connected! Ready to transfer files. Drop a file or click the file area to select.', 'success');
      } else if (state === 'offering_file' || state === 'transferring') {
        this.showStatus(`📤 ${state === 'offering_file' ? 'Offering file to peer...' : 'Transferring file...'}`, 'info');
      }
    };

    this.session.onProgress = (current, total, message) => {
      this.elements.progressContainer.classList.remove('hidden');
      const percent = Math.round((current / total) * 100);
      this.elements.progressFill.style.width = `${percent}%`;
      this.elements.progressText.textContent = message;
    };

    this.session.onComplete = (file) => {
      this.showStatus(`Transfer complete: ${file.name}`, 'success');
      this.downloadFile(file);
    };

    this.session.onError = (message) => {
      this.showStatus(`Error: ${message}`, 'error');
    };

    // UI event handlers
    this.elements.startSession.addEventListener('click', async () => {
      // First check if libraries are available
      const qriousAvailable = typeof QRious !== 'undefined';
      console.log('Start Session clicked - QRious available:', qriousAvailable);
      
      if (!qriousAvailable) {
        console.error('Cannot start session: QRious library not available');
        this.showStatus('❌ Cannot generate QR codes: Library not loaded. Check console for details.', 'error');
        
        // Show library status in the QR display area
        this.elements.qrDisplay.innerHTML = `
          <div style="color: red; text-align: center; padding: 20px;">
            <strong>QR Generation Unavailable</strong><br>
            <small>Check browser console for details</small><br><br>
            <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px;">
              QRious: ${typeof QRious}<br>
              User Agent: ${navigator.userAgent.substring(0, 50)}...
            </div>
          </div>
        `;
        return;
      }
      
      // Check if we're already in a session
      if (this.session.state !== 'idle') {
        this.showStatus('⚠️ Session already active. Stop current session to start a new one.', 'error');
        return;
      }
      
      this.showStatus('📱 Starting session... The other device should scan this QR code (not start its own session!)', 'success');
      const message = this.session.startSession();
      await this.displayQR(message);
      
      // Update the button text to make the flow clearer
      this.elements.startSession.textContent = 'Session Active';
      this.elements.startSession.disabled = true;
    });

    this.elements.resetSession.addEventListener('click', () => {
      // Reset session state
      this.session.state = 'idle';
      this.session.sessionId = null;
      this.session.isInitiator = false;
      this.session.peerCapabilities = null;
      this.session.currentFile = null;
      this.session.transferData = null;
      this.session.receivedChunks.clear();
      
      // Reset UI
      this.elements.qrDisplay.innerHTML = '<div style="opacity: 0.5;">QR Code will appear here</div>';
      this.elements.progressContainer.classList.add('hidden');
      
      // Trigger state change to update UI
      this.session.notifyStateChange();
      
      this.showStatus('🔄 Session reset. Ready to start fresh.', 'success');
    });

    this.elements.debugLibs.addEventListener('click', () => {
      const debugInfo = {
        QRious: {
          available: typeof QRious !== 'undefined',
          type: typeof QRious,
          constructor: typeof QRious !== 'undefined' ? QRious.name : 'N/A'
        },
        jsQR: {
          available: typeof jsQR !== 'undefined',
          type: typeof jsQR
        },
        environment: {
          userAgent: navigator.userAgent,
          url: window.location.href,
          protocol: window.location.protocol,
          host: window.location.host
        },
        scripts: Array.from(document.scripts)
          .map(s => s.src)
          .filter(s => s.includes('qr') || s.includes('QR'))
      };
      
      console.log('🔍 Debug Info:', debugInfo);
      
      this.elements.qrDisplay.innerHTML = `
        <div style="text-align: left; font-family: monospace; font-size: 11px; padding: 15px; background: #f5f5f5; border-radius: 8px; max-height: 280px; overflow-y: auto;">
          <strong>Library Debug Information:</strong><br><br>
          <strong>QRious:</strong> ${debugInfo.QRious.available ? '✅' : '❌'} (${debugInfo.QRious.type})<br>
          <strong>jsQR:</strong> ${debugInfo.jsQR.available ? '✅' : '❌'} (${debugInfo.jsQR.type})<br><br>
          <strong>Environment:</strong><br>
          URL: ${debugInfo.environment.url}<br>
          Protocol: ${debugInfo.environment.protocol}<br><br>
          <strong>QR Scripts:</strong><br>
          ${debugInfo.scripts.length ? debugInfo.scripts.join('<br>') : 'None found'}<br><br>
          <strong>User Agent:</strong><br>
          ${debugInfo.environment.userAgent}
        </div>
      `;
      
      this.showStatus('Debug info displayed. Check console for full details.', 'success');
    });

    this.elements.startCamera.addEventListener('click', async () => {
      const started = await this.scanner.startCamera();
      if (started) {
        this.elements.startCamera.disabled = true;
        this.elements.useBackCamera.disabled = false;
        this.elements.useFrontCamera.disabled = false;
        this.elements.stopCamera.disabled = false;
        this.showStatus('Camera started. Point at QR codes to scan.', 'success');
      } else {
        this.elements.startCamera.disabled = false;
        this.elements.useBackCamera.disabled = true;
        this.elements.useFrontCamera.disabled = true;
        this.elements.stopCamera.disabled = true;
        
        // Provide specific error message based on the environment
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
          this.showStatus('❌ Camera requires HTTPS or localhost. Use manual input instead.', 'error');
        } else if (!navigator.mediaDevices) {
          this.showStatus('❌ Camera API not supported in this browser. Use manual input instead.', 'error');
        } else {
          this.showStatus('❌ Camera access denied. Check permissions or use manual input.', 'error');
        }
      }
    });

    this.elements.useBackCamera.addEventListener('click', async () => {
      this.showStatus('Switching to back camera...', 'info');
      this.scanner.stopCamera();
      
      const started = await this.scanner.startCamera('environment');
      if (started && this.scanner.currentFacingMode === 'environment') {
        this.scanner.preferredFacingMode = 'environment';
        this.showStatus('✅ Switched to back camera. Better for scanning QR codes!', 'success');
      } else if (started) {
        // Camera started but may not be the exact one requested (desktop scenario)
        this.scanner.preferredFacingMode = 'environment';
        this.showStatus('📷 Camera active (may be the only available camera on this device)', 'success');
      } else {
        this.showStatus('❌ Back camera not available. Using current camera.', 'error');
        await this.scanner.startCamera(); // Restart with fallback
      }
    });

    this.elements.useFrontCamera.addEventListener('click', async () => {
      this.showStatus('Switching to front camera...', 'info');
      this.scanner.stopCamera();
      
      const started = await this.scanner.startCamera('user');
      if (started && this.scanner.currentFacingMode === 'user') {
        this.scanner.preferredFacingMode = 'user';
        this.showStatus('✅ Switched to front camera.', 'success');
      } else if (started) {
        // Camera started but may not be the exact one requested (desktop scenario)
        this.scanner.preferredFacingMode = 'user';
        this.showStatus('📷 Camera active (may be the only available camera on this device)', 'success');
      } else {
        this.showStatus('❌ Front camera not available. Using current camera.', 'error');
        await this.scanner.startCamera(); // Restart with fallback
      }
    });

    this.elements.stopCamera.addEventListener('click', () => {
      this.scanner.stopCamera();
      this.elements.startCamera.disabled = false;
      this.elements.useBackCamera.disabled = true;
      this.elements.useFrontCamera.disabled = true;
      this.elements.stopCamera.disabled = true;
      this.showStatus('Camera stopped.');
    });

    this.elements.processManual.addEventListener('click', () => {
      const data = this.elements.manualInput.value.trim();
      if (data) {
        this.handleQRDetection(data);
        this.elements.manualInput.value = '';
      } else {
        this.showStatus('Please enter QRX data to process.', 'error');
      }
    });

    // File handling
    this.elements.fileDrop.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    this.elements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleFileSelection(file);
      }
    });

    // Drag and drop
    this.elements.fileDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.fileDrop.classList.add('dragover');
    });

    this.elements.fileDrop.addEventListener('dragleave', () => {
      this.elements.fileDrop.classList.remove('dragover');
    });

    this.elements.fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.fileDrop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        this.handleFileSelection(file);
      }
    });

    // QR scanner callback
    this.scanner.onQRDetected = (data) => {
      this.handleQRDetection(data);
    };

    // Adjust overlay on window resize
    window.addEventListener('resize', () => {
      if (this.scanner.video && this.scanner.video.srcObject) {
        setTimeout(() => this.scanner.adjustOverlayPosition(), 100);
      }
    });
  }

  async handleFileSelection(file) {
    try {
      this.showStatus(`Selected: ${file.name} (${this.formatFileSize(file.size)})`);
      
      if (this.session.state === 'connected') {
        const message = await this.session.offerFile(file);
        await this.displayQR(message);
      } else {
        this.showStatus('Please connect to a device first by starting a session or scanning a QR code.');
      }
    } catch (error) {
      this.showStatus(`Error: ${error.message}`, 'error');
    }
  }

  async handleQRDetection(data) {
    try {
      console.log('🔍 QR Detection - Raw data received:', data);
      console.log('🔍 QR Detection - Data type:', typeof data);
      console.log('🔍 QR Detection - Data length:', data ? data.length : 'null/undefined');
      
      if (!data || typeof data !== 'string') {
        console.error('❌ Invalid QR data: not a string or empty');
        this.showStatus('Invalid QR data received', 'error');
        return;
      }
      
      // Try to validate it's JSON before passing to session
      let parsedData;
      try {
        parsedData = JSON.parse(data);
        console.log('✅ QR data is valid JSON');
        console.log('🔍 Message type:', parsedData.type);
      } catch (jsonError) {
        console.error('❌ QR data is not valid JSON:', jsonError.message);
        console.error('❌ Raw data preview:', data.substring(0, 100) + (data.length > 100 ? '...' : ''));
        this.showStatus('QR code contains invalid data format - not a QRX code', 'error');
        return;
      }
      
      // Provide feedback based on message type
      if (parsedData.type === 'handshake') {
        this.showStatus('🤝 Detected connection request, processing...', 'info');
      } else if (parsedData.type === 'handshake_ack') {
        this.showStatus('✅ Connection confirmed!', 'success');
      } else if (parsedData.type === 'file_offer') {
        this.showStatus('📁 File offer detected...', 'info');
      }
      
      const response = this.session.handleMessage(data);
      if (response) {
        await this.displayQR(response);
      }
    } catch (error) {
      console.error('❌ QR processing error:', error);
      this.showStatus(`QR processing error: ${error.message}`, 'error');
    }
  }

  async displayQR(data) {
    // Show loading state
    this.elements.qrDisplay.innerHTML = '<div style="opacity: 0.5;">Generating QR code...</div>';
    
    try {
      console.log('Attempting to generate QR for data:', data.substring(0, 50) + '...');
      console.log('QRious available:', typeof QRious !== 'undefined');
      
      const qrDataURL = await QRGenerator.generateDataURL(data, { size: 280 });
      console.log('QR generation completed, data URL length:', qrDataURL.length);
      
      this.elements.qrDisplay.innerHTML = `<img src="${qrDataURL}" alt="QR Code" style="max-width: 100%; height: auto;">`;
      this.currentQR = data;
      
      console.log('QR code displayed successfully');
    } catch (error) {
      console.error('QR display error:', error);
      this.elements.qrDisplay.innerHTML = `<div style="color: red;">QR generation failed: ${error.message}</div>`;
      
      // Show the raw data as fallback
      this.elements.qrDisplay.innerHTML += `<div style="margin-top: 10px; font-size: 12px; font-family: monospace; word-break: break-all; max-height: 200px; overflow-y: auto; background: #f5f5f5; padding: 10px; border-radius: 4px;">${data}</div>`;
    }
  }

  downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  showStatus(message, type = 'info') {
    this.elements.status.textContent = message;
    this.elements.status.className = 'status';
    if (type !== 'info') {
      this.elements.status.classList.add(type);
    }
    this.elements.status.classList.remove('hidden');
  }
}

// Library loading utilities
class LibraryLoader {
  static async ensureQRLibraries() {
    const maxRetries = 5;
    let retries = 0;
    
    console.log('Checking for QR libraries...');
    console.log('User Agent:', navigator.userAgent);
    console.log('URL:', window.location.href);
    
    while (retries < maxRetries) {
      // Check if libraries are loaded
      const qriousLoaded = typeof QRious !== 'undefined';
      const jsQRLoaded = typeof jsQR !== 'undefined';
      
      console.log(`Attempt ${retries + 1}: QRious=${qriousLoaded}, jsQR=${jsQRLoaded}`);
      
      if (qriousLoaded && jsQRLoaded) {
        console.log('✅ All QR libraries loaded successfully!');
        // Test QRious functionality
        try {
          const testCanvas = document.createElement('canvas');
          const testQR = new QRious({
            element: testCanvas,
            value: 'test',
            size: 100
          });
          console.log('✅ QRious functionality verified');
        } catch (e) {
          console.error('❌ QRious loaded but not functional:', e);
        }
        return true;
      }
      
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 800));
      retries++;
    }
    
    console.error('❌ QR libraries failed to load after all retries');
    console.error('Final check:', {
      QRious: typeof QRious,
      jsQR: typeof jsQR,
      scripts: Array.from(document.scripts).map(s => s.src).filter(s => s.includes('qr'))
    });
    
    console.warn('⚠️ QR libraries not loaded from CDN, using fallback implementations');
    console.log('Manual data entry will be available for QR scanning');
    return false;
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Show loading status
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = 'Loading QR libraries...';
    statusElement.className = 'status';
    statusElement.classList.remove('hidden');
  }
  
  // Try to ensure libraries are loaded
  const librariesLoaded = await LibraryLoader.ensureQRLibraries();
  
  // Initialize app
  window.qrxApp = new QRXApp();
  
  // Update status based on library loading
  if (librariesLoaded) {
    window.qrxApp.showStatus('✅ Full QR functionality available! Ready to transfer files.', 'success');
  } else {
    window.qrxApp.showStatus('⚠️ Limited mode: Manual data entry available (CDN libraries failed to load)');
  }
});