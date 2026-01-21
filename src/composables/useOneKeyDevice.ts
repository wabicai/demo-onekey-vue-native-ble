import { ref, reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import OneKeySDK from '@onekeyfe/hd-common-connect-sdk'
import {
  UI_EVENT,
  DEVICE_EVENT,
  UI_REQUEST,
  UI_RESPONSE,
  type CoreMessage,
  type ConnectSettings,
  type SearchDevice
} from '@onekeyfe/hd-core'
import { OneKeyCapacitorBluetooth } from '../lib/OneKeyCapacitorBluetooth'

const doLog = true

// State
const isInitialized = ref(false)
const isConnecting = ref(false)
const isLoading = ref(false)
const devices = ref<SearchDevice[]>([])
const connectedDevice = ref<SearchDevice | null>(null)
const deviceFeatures = ref<any>(null)
const logs = reactive<string[]>([])
const result = ref<string>('')

// UI Dialog State
const showPinDialog = ref(false)
const showPassphraseDialog = ref(false)
const showButtonConfirmDialog = ref(false)
const buttonConfirmMessage = ref('')
let pinResolve: ((pin: string) => void) | null = null
let passphraseResolve: ((passphrase: { value: string; onDevice: boolean }) => void) | null = null

// Logging helper
function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString()
  const logEntry = `[${timestamp}] ${message}`
  logs.push(logEntry)
  if (doLog) console.log('OneKey:', message)

  // Keep only last 100 logs
  if (logs.length > 100) {
    logs.shift()
  }
}

// Setup event handlers
function setupEventHandlers() {
  OneKeySDK.on(UI_EVENT, async (message: CoreMessage) => {
    addLog(`UI_EVENT: ${message.type}`)

    if (message.type === UI_REQUEST.REQUEST_PIN) {
      addLog('PIN requested - showing PIN dialog')

      // Show PIN dialog and wait for user input
      const pin = await requestPinInput()

      // If user entered PIN, use it; otherwise use device input
      const pinPayload = pin || '@@ONEKEY_INPUT_PIN_IN_DEVICE'
      addLog(pin ? 'PIN entered via app' : 'Using device PIN input')

      OneKeySDK.uiResponse({
        type: UI_RESPONSE.RECEIVE_PIN,
        payload: pinPayload
      })
    }

    if (message.type === UI_REQUEST.REQUEST_PASSPHRASE) {
      addLog('Passphrase requested - showing dialog')

      // Show passphrase dialog and wait for user input
      const { value, onDevice } = await requestPassphraseInput()

      OneKeySDK.uiResponse({
        type: UI_RESPONSE.RECEIVE_PASSPHRASE,
        payload: {
          value: value,
          passphraseOnDevice: onDevice,
          save: false
        }
      })
    }

    if (message.type === UI_REQUEST.REQUEST_BUTTON) {
      const msg = (message.payload as any)?.message || 'Please confirm on your device'
      addLog(`Button confirmation: ${msg}`)
      buttonConfirmMessage.value = msg
      showButtonConfirmDialog.value = true
    }

    if (message.type === UI_REQUEST.CLOSE_UI_WINDOW) {
      addLog('UI window closed')
      closeAllDialogs()
    }
  })

  OneKeySDK.on(DEVICE_EVENT, (message: CoreMessage) => {
    addLog(`DEVICE_EVENT: ${message.type}`)
  })
}

// Request PIN input from user
function requestPinInput(): Promise<string> {
  return new Promise((resolve) => {
    pinResolve = resolve
    showPinDialog.value = true
  })
}

// Submit PIN from dialog
function submitPin(pin: string) {
  showPinDialog.value = false
  if (pinResolve) {
    pinResolve(pin)
    pinResolve = null
  }
}

// Use device PIN input instead
function useDevicePin() {
  showPinDialog.value = false
  if (pinResolve) {
    pinResolve('') // Empty string means use device input
    pinResolve = null
  }
}

// Request passphrase input from user
function requestPassphraseInput(): Promise<{ value: string; onDevice: boolean }> {
  return new Promise((resolve) => {
    passphraseResolve = resolve
    showPassphraseDialog.value = true
  })
}

// Submit passphrase from dialog
function submitPassphrase(passphrase: string) {
  showPassphraseDialog.value = false
  if (passphraseResolve) {
    passphraseResolve({ value: passphrase, onDevice: false })
    passphraseResolve = null
  }
}

// Use device passphrase input instead
function useDevicePassphrase() {
  showPassphraseDialog.value = false
  if (passphraseResolve) {
    passphraseResolve({ value: '', onDevice: true })
    passphraseResolve = null
  }
}

// Close button confirmation dialog
function closeButtonConfirm() {
  showButtonConfirmDialog.value = false
}

// Close all dialogs
function closeAllDialogs() {
  showPinDialog.value = false
  showPassphraseDialog.value = false
  showButtonConfirmDialog.value = false
}

// Initialize OneKey SDK
async function initOneKey(): Promise<boolean> {
  if (isInitialized.value) {
    addLog('Already initialized')
    return true
  }

  try {
    addLog('Initializing OneKey SDK...')
    isLoading.value = true

    const settings: Partial<ConnectSettings> = {
      debug: true,
      fetchConfig: false
    }

    let adapter: any = undefined

    if (Capacitor.isNativePlatform()) {
      addLog('Using BLE adapter for mobile')
      settings.env = 'lowlevel'
      adapter = new OneKeyCapacitorBluetooth()
    } else {
      addLog('Using WebUSB for desktop')
      settings.env = 'webusb'
    }

    const success = await OneKeySDK.init(settings, undefined, adapter)

    if (!success) {
      throw new Error('SDK init returned false')
    }

    setupEventHandlers()
    isInitialized.value = true
    addLog('SDK initialized successfully!')

    return true
  } catch (e: any) {
    addLog(`Init failed: ${e.message || e}`)
    console.error('Init error:', e)
    return false
  } finally {
    isLoading.value = false
  }
}

// Search for devices and auto-connect if one is found
async function searchDevices(): Promise<SearchDevice[]> {
  addLog('Searching for devices...')
  isLoading.value = true

  try {
    if (!isInitialized.value) {
      const success = await initOneKey()
      if (!success) {
        throw new Error('Failed to initialize SDK')
      }
    }

    const response = await OneKeySDK.searchDevices()

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'Search failed')
    }

    devices.value = response.payload
    addLog(`Found ${devices.value.length} device(s)`)

    // Auto-connect if exactly one device is found
    if (devices.value.length === 1 && devices.value[0].connectId) {
      addLog('Auto-connecting to the found device...')
      // Don't set isLoading to false yet, continue with connection
      await connectDevice(devices.value[0])
    }

    return devices.value
  } catch (e: any) {
    addLog(`Search failed: ${e.message || e}`)
    throw e
  } finally {
    isLoading.value = false
  }
}

// Get device features/info
async function getFeatures(connectId?: string): Promise<any> {
  const id = connectId || connectedDevice.value?.connectId
  if (!id) {
    throw new Error('No device connected')
  }

  addLog(`Getting device features for ${id}...`)
  isLoading.value = true

  try {
    const response = await OneKeySDK.getFeatures(id)

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'getFeatures failed')
    }

    deviceFeatures.value = response.payload
    const info = `Device: ${deviceFeatures.value.label || 'Unknown'}, Model: ${deviceFeatures.value.model || 'Unknown'}, FW: ${deviceFeatures.value.major_version}.${deviceFeatures.value.minor_version}.${deviceFeatures.value.patch_version}`
    addLog(info)
    result.value = JSON.stringify(response.payload, null, 2)

    return deviceFeatures.value
  } catch (e: any) {
    addLog(`getFeatures failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Connect to a device
async function connectDevice(device: SearchDevice): Promise<void> {
  addLog(`Connecting to ${device.name || device.connectId}...`)
  isConnecting.value = true

  try {
    await getFeatures(device.connectId!)
    connectedDevice.value = device
    addLog('Device connected!')
  } catch (e: any) {
    addLog(`Connection failed: ${e.message || e}`)
    throw e
  } finally {
    isConnecting.value = false
  }
}

// Helper to get device info
function getDeviceInfo() {
  const device = connectedDevice.value
  if (!device?.connectId) {
    throw new Error('No device connected')
  }
  return {
    connectId: device.connectId,
    deviceId: device.deviceId || ''
  }
}

// Get BTC Address
async function getBtcAddress(): Promise<string> {
  const { connectId, deviceId } = getDeviceInfo()
  addLog('Getting BTC address...')
  isLoading.value = true

  try {
    const response = await OneKeySDK.btcGetAddress(connectId, deviceId, {
      path: "m/44'/0'/0'/0/0",
      coin: 'btc',
      showOnOneKey: false
    })

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'btcGetAddress failed')
    }

    addLog(`BTC Address: ${response.payload.address}`)
    result.value = JSON.stringify(response.payload, null, 2)
    return response.payload.address
  } catch (e: any) {
    addLog(`getBtcAddress failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Get EVM Address (Ethereum)
async function getEvmAddress(): Promise<string> {
  const { connectId, deviceId } = getDeviceInfo()
  addLog('Getting EVM address...')
  isLoading.value = true

  try {
    const response = await OneKeySDK.evmGetAddress(connectId, deviceId, {
      path: "m/44'/60'/0'/0/0",
      chainId: 1,
      showOnOneKey: false
    })

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'evmGetAddress failed')
    }

    addLog(`EVM Address: ${response.payload.address}`)
    result.value = JSON.stringify(response.payload, null, 2)
    return response.payload.address
  } catch (e: any) {
    addLog(`getEvmAddress failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Get Cardano Public Key
async function getCardanoPublicKey(): Promise<any> {
  const { connectId, deviceId } = getDeviceInfo()
  addLog('Getting Cardano public key...')
  isLoading.value = true

  try {
    // derivationType: 1 for Classic, 2 for Touch/Pro
    // Detect device type from features if available
    const isTouch = deviceFeatures.value?.model?.toLowerCase()?.includes('touch') ||
                    deviceFeatures.value?.model?.toLowerCase()?.includes('pro')
    const derivationType = isTouch ? 2 : 1

    addLog(`Using derivationType: ${derivationType} (${isTouch ? 'Touch/Pro' : 'Classic'})`)

    const response = await OneKeySDK.cardanoGetPublicKey(connectId, deviceId, {
      path: "m/1852'/1815'/0'",
      derivationType,
      showOnOneKey: false
    })

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'cardanoGetPublicKey failed')
    }

    addLog(`Cardano Public Key: ${response.payload.xpub?.substring(0, 20)}...`)
    result.value = JSON.stringify(response.payload, null, 2)
    return response.payload
  } catch (e: any) {
    addLog(`getCardanoPublicKey failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Check Firmware Release
async function checkFirmwareRelease(): Promise<any> {
  const { connectId } = getDeviceInfo()
  addLog('Checking firmware release...')
  isLoading.value = true

  try {
    const response = await OneKeySDK.checkFirmwareRelease(connectId)

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'checkFirmwareRelease failed')
    }

    addLog(`Firmware check complete`)
    result.value = JSON.stringify(response.payload, null, 2)
    return response.payload
  } catch (e: any) {
    addLog(`checkFirmwareRelease failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Check BLE Firmware Release
async function checkBleFirmwareRelease(): Promise<any> {
  const { connectId } = getDeviceInfo()
  addLog('Checking BLE firmware release...')
  isLoading.value = true

  try {
    const response = await OneKeySDK.checkBLEFirmwareRelease(connectId)

    if (!response?.success) {
      throw new Error(response?.payload?.error || 'checkBLEFirmwareRelease failed')
    }

    addLog(`BLE firmware check complete`)
    result.value = JSON.stringify(response.payload, null, 2)
    return response.payload
  } catch (e: any) {
    addLog(`checkBLEFirmwareRelease failed: ${e.message || e}`)
    result.value = `Error: ${e.message || e}`
    throw e
  } finally {
    isLoading.value = false
  }
}

// Clear logs
function clearLogs() {
  logs.length = 0
  result.value = ''
}

export function useOneKeyDevice() {
  return {
    // State
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
  }
}
