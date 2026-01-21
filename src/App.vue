<script setup lang="ts">
import { ref } from 'vue'
import { useOneKeyDevice } from './composables/useOneKeyDevice'

const {
  isInitialized,
  isConnecting,
  isLoading,
  devices,
  connectedDevice,
  deviceFeatures,
  logs,
  result,
  // Dialog State
  showPinDialog,
  showPassphraseDialog,
  showButtonConfirmDialog,
  buttonConfirmMessage,
  // Methods
  initOneKey,
  searchDevices,
  getFeatures,
  connectDevice,
  getBtcAddress,
  getEvmAddress,
  getCardanoPublicKey,
  checkFirmwareRelease,
  checkBleFirmwareRelease,
  clearLogs,
  // Dialog Methods
  submitPin,
  useDevicePin,
  submitPassphrase,
  useDevicePassphrase,
  closeButtonConfirm
} = useOneKeyDevice()

// PIN input state
const pinInput = ref('')
// PIN keyboard map (same as reference project)
const pinKeyboardMap = ['7', '8', '9', '4', '5', '6', '1', '2', '3']

// Passphrase input state
const passphraseInput = ref('')

function handlePinButtonClick(index: number) {
  pinInput.value += pinKeyboardMap[index]
}

function handlePinSubmit() {
  submitPin(pinInput.value)
  pinInput.value = ''
}

function handlePinOnDevice() {
  useDevicePin()
  pinInput.value = ''
}

function handlePassphraseSubmit() {
  submitPassphrase(passphraseInput.value)
  passphraseInput.value = ''
}

function handlePassphraseOnDevice() {
  useDevicePassphrase()
  passphraseInput.value = ''
}

async function handleAction(action: () => Promise<any>) {
  try {
    await action()
  } catch (e) {
    console.error(e)
  }
}

async function handleConnect(device: any) {
  try {
    await connectDevice(device)
  } catch (e) {
    console.error(e)
  }
}

</script>

<template>
  <div class="container">
    <header>
      <h1>OneKey BLE Demo</h1>
      <p class="status" :class="{ active: isInitialized }">
        {{ isInitialized ? 'SDK Initialized' : 'SDK Not Initialized' }}
      </p>
    </header>

    <!-- Loading Overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>Loading...</span>
    </div>

    <section class="actions">
      <button @click="handleAction(initOneKey)" :disabled="isInitialized || isLoading" class="primary">
        Initialize SDK
      </button>

      <button @click="handleAction(searchDevices)" :disabled="!isInitialized || isLoading" class="primary">
        {{ isConnecting ? 'Connecting...' : 'Search Devices' }}
      </button>
    </section>

    <section v-if="devices.length > 0" class="devices">
      <h2>Found Devices</h2>
      <div
        v-for="device in devices"
        :key="device.connectId || device.deviceId || Math.random()"
        class="device-card"
        :class="{ connected: connectedDevice?.connectId === device.connectId }"
        @click="handleConnect(device)"
      >
        <div class="device-name">{{ device.name || 'Unknown Device' }}</div>
        <div class="device-id">{{ device.connectId }}</div>
        <div v-if="connectedDevice?.connectId === device.connectId" class="connected-badge">
          Connected
        </div>
      </div>
    </section>

    <section v-if="connectedDevice" class="actions">
      <h2>Device Info</h2>
      <button @click="handleAction(getFeatures)" :disabled="isLoading">
        Get Features
      </button>
      <button @click="handleAction(checkFirmwareRelease)" :disabled="isLoading">
        Check Firmware
      </button>
      <button @click="handleAction(checkBleFirmwareRelease)" :disabled="isLoading">
        Check BLE Firmware
      </button>
    </section>

    <section v-if="connectedDevice" class="actions">
      <h2>Get Address / Public Key</h2>
      <button @click="handleAction(getBtcAddress)" :disabled="isLoading">
        Get BTC Address
      </button>
      <button @click="handleAction(getEvmAddress)" :disabled="isLoading">
        Get EVM Address
      </button>
      <button @click="handleAction(getCardanoPublicKey)" :disabled="isLoading">
        Get Cardano Public Key
      </button>
    </section>

    <section v-if="deviceFeatures" class="features">
      <h2>Device Info</h2>
      <div class="feature-grid">
        <div class="feature-item">
          <span class="label">Label:</span>
          <span class="value">{{ deviceFeatures.label || '-' }}</span>
        </div>
        <div class="feature-item">
          <span class="label">Connect ID:</span>
          <span class="value">{{ connectedDevice?.connectId || '-' }}</span>
        </div>
        <div class="feature-item">
          <span class="label">Device ID:</span>
          <span class="value">{{ deviceFeatures.device_id || '-' }}</span>
        </div>
        <div class="feature-item">
          <span class="label">Firmware:</span>
          <span class="value">{{ deviceFeatures.onekey_firmware_version || '-' }}</span>
        </div>
      </div>
    </section>

    <section v-if="result" class="result">
      <h2>Result</h2>
      <pre class="result-content">{{ result }}</pre>
    </section>

    <section class="logs">
      <h2>
        Logs
        <button @click="clearLogs" class="clear-btn">Clear</button>
      </h2>
      <div class="log-container">
        <div
          v-for="(log, index) in logs"
          :key="index"
          class="log-entry"
        >
          {{ log }}
        </div>
        <div v-if="logs.length === 0" class="log-empty">
          No logs yet. Click "Initialize SDK" to start.
        </div>
      </div>
    </section>

    <!-- PIN Dialog -->
    <div v-if="showPinDialog" class="dialog-overlay">
      <div class="dialog">
        <h3>Enter PIN</h3>
        <p class="dialog-hint">Enter PIN using the pattern shown on your device</p>
        <div class="pin-display">
          <span v-for="i in pinInput.length" :key="i" class="pin-dot"></span>
          <span v-if="pinInput.length === 0" class="pin-placeholder">Tap numbers below</span>
        </div>
        <div class="pin-keyboard">
          <button
            v-for="(_, index) in 9"
            :key="index"
            class="pin-key"
            @click="handlePinButtonClick(index)"
          >
            *
          </button>
        </div>
        <div class="dialog-actions">
          <button @click="handlePinOnDevice" class="secondary">Use Device</button>
          <button @click="handlePinSubmit" class="primary" :disabled="pinInput.length === 0">Confirm</button>
        </div>
      </div>
    </div>

    <!-- Passphrase Dialog -->
    <div v-if="showPassphraseDialog" class="dialog-overlay">
      <div class="dialog">
        <h3>Enter Passphrase</h3>
        <p class="dialog-hint">Optional passphrase for hidden wallet</p>
        <input
          v-model="passphraseInput"
          type="password"
          class="passphrase-input"
          placeholder="Enter passphrase (optional)"
        />
        <div class="dialog-actions">
          <button @click="handlePassphraseOnDevice" class="secondary">Use Device</button>
          <button @click="handlePassphraseSubmit" class="primary">Confirm</button>
        </div>
      </div>
    </div>

    <!-- Button Confirmation Dialog -->
    <div v-if="showButtonConfirmDialog" class="dialog-overlay">
      <div class="dialog">
        <h3>Confirm on Device</h3>
        <p class="dialog-message">{{ buttonConfirmMessage }}</p>
        <div class="dialog-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <button @click="closeButtonConfirm" class="secondary">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  padding-bottom: 40px;
}

header {
  text-align: center;
  margin-bottom: 24px;
}

h1 {
  font-size: 24px;
  margin-bottom: 8px;
  color: #fff;
}

h2 {
  font-size: 16px;
  margin-bottom: 12px;
  color: #aaa;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  background: #333;
  color: #888;
}

.status.active {
  background: #1a472a;
  color: #4ade80;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: white;
  gap: 16px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #333;
  border-top-color: #00d4aa;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

button {
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: #333;
  color: white;
  transition: all 0.2s;
}

button.primary {
  background: linear-gradient(135deg, #00d4aa 0%, #00a896 100%);
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
  opacity: 0.9;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: #333;
}

.devices {
  margin-bottom: 20px;
}

.device-card {
  background: #252542;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  position: relative;
}

.device-card:hover {
  border-color: #00d4aa;
}

.device-card.connected {
  border-color: #4ade80;
}

.device-name {
  font-weight: 600;
  margin-bottom: 4px;
}

.device-id {
  font-size: 12px;
  color: #888;
  font-family: monospace;
}

.connected-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: #1a472a;
  color: #4ade80;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.features {
  margin-bottom: 20px;
}

.feature-grid {
  background: #252542;
  border-radius: 8px;
  padding: 12px;
}

.feature-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #333;
  font-size: 14px;
}

.feature-item:last-child {
  border-bottom: none;
}

.label {
  color: #888;
}

.value {
  font-family: monospace;
}

.result {
  margin-bottom: 20px;
}

.result-content {
  background: #0a0a14;
  border-radius: 8px;
  padding: 12px;
  font-family: monospace;
  font-size: 11px;
  color: #4ade80;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.logs {
  margin-bottom: 20px;
}

.log-container {
  background: #0a0a14;
  border-radius: 8px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 11px;
}

.log-entry {
  padding: 3px 0;
  color: #4ade80;
  word-break: break-all;
}

.log-entry:nth-child(even) {
  color: #60a5fa;
}

.log-empty {
  color: #666;
  text-align: center;
  padding: 20px;
}

/* Dialog Styles */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}

.dialog {
  background: #1a1a2e;
  border-radius: 16px;
  padding: 24px;
  width: 90%;
  max-width: 320px;
  text-align: center;
}

.dialog h3 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #fff;
}

.dialog-hint {
  color: #888;
  font-size: 13px;
  margin: 0 0 20px;
}

.dialog-message {
  color: #ccc;
  font-size: 14px;
  margin: 0 0 20px;
  line-height: 1.5;
}

.dialog-icon {
  color: #00d4aa;
  margin: 20px 0;
}

.dialog-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.dialog-actions button {
  flex: 1;
}

.dialog-actions button.secondary {
  background: #333;
}

.dialog-actions button.primary {
  background: linear-gradient(135deg, #00d4aa 0%, #00a896 100%);
}

/* PIN Display */
.pin-display {
  background: #0a0a14;
  border-radius: 8px;
  padding: 16px;
  min-height: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.pin-dot {
  width: 12px;
  height: 12px;
  background: #00d4aa;
  border-radius: 50%;
}

.pin-placeholder {
  color: #666;
  font-size: 13px;
}

/* PIN Keyboard */
.pin-keyboard {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.pin-key {
  aspect-ratio: 1;
  font-size: 24px;
  background: #252542;
  border: none;
  border-radius: 12px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.pin-key:hover {
  background: #333355;
}

.pin-key:active {
  transform: scale(0.95);
}

/* Passphrase Input */
.passphrase-input {
  width: 100%;
  padding: 14px;
  background: #0a0a14;
  border: 1px solid #333;
  border-radius: 8px;
  color: #fff;
  font-size: 16px;
  box-sizing: border-box;
}

.passphrase-input:focus {
  outline: none;
  border-color: #00d4aa;
}

.passphrase-input::placeholder {
  color: #666;
}
</style>
