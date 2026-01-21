import { BleClient } from '@capacitor-community/bluetooth-le'
import { Capacitor } from '@capacitor/core'
import type { LowlevelTransportSharedPlugin } from '@onekeyfe/hd-transport'

const doLog = true

// OneKey Service & Characteristic UUIDs
const ONEKEY_SERVICE_UUID = '00000001-0000-1000-8000-00805f9b34fb'
const ONEKEY_WRITE_UUID = '00000002-0000-1000-8000-00805f9b34fb'
const ONEKEY_NOTIFY_UUID = '00000003-0000-1000-8000-00805f9b34fb'

// Protocol Constants
const MESSAGE_TOP_CHAR = 63      // 0x3f = '?'
const MESSAGE_HEADER_BYTE = 35   // 0x23 = '#'
const COMMON_HEADER_SIZE = 6     // Type (2) + Length (4)

// Helper: Check if chunk is a header chunk (starts with 3f 23 23)
function isHeaderChunk(chunk: Uint8Array): boolean {
  if (chunk.length < 9) return false
  const [magicQuestion, sharp1, sharp2] = chunk
  return (
    magicQuestion === MESSAGE_TOP_CHAR &&
    sharp1 === MESSAGE_HEADER_BYTE &&
    sharp2 === MESSAGE_HEADER_BYTE
  )
}

// Helper: Read big-endian int32 from buffer
function readInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0
}

// Hex conversion utilities
function dataViewToUint8Array(dataView: DataView): Uint8Array {
  return new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)
}

function uint8ArrayToHex(arr: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0')
  }
  return hex
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function hexToDataView(hex: string): DataView {
  const bytes = hexToUint8Array(hex)
  return new DataView(bytes.buffer)
}

// Deferred promise helper 
interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let localResolve: (value: T) => void = () => {}
  let localReject: (error: Error) => void = () => {}

  const promise = new Promise<T>((resolve, reject) => {
    localResolve = resolve
    localReject = reject
  })

  return {
    promise,
    resolve: localResolve,
    reject: localReject
  }
}

export class OneKeyCapacitorBluetooth implements LowlevelTransportSharedPlugin {
  version = 'OneKey-1.0'

  private currentDeviceUuid: string | null = null

  // Message reassembly buffer
  private bufferLength = 0
  private buffer: number[] = []

  // Deferred promise for receive()
  private runPromise: Deferred<string> | null = null

  constructor() {}

  async init(): Promise<void> {
    if (doLog) console.log('OneKeyBLE: [init] Starting initialization...')

    try {
      await BleClient.initialize({ androidNeverForLocation: true })
      if (doLog) console.log('OneKeyBLE: [init] BleClient initialized')

      if (Capacitor.getPlatform() === 'android') {
        const isEnabled = await BleClient.isEnabled()
        if (doLog) console.log('OneKeyBLE: [init] Bluetooth enabled:', isEnabled)

        if (!isEnabled) {
          await BleClient.requestEnable()
        }
      }
    } catch (error) {
      console.error('OneKeyBLE: [init] FAILED', error)
      throw error
    }
  }

  async enumerate() {
    if (doLog) console.log('OneKeyBLE: [enumerate] Scanning...')

    try {
      // Check for already connected devices first
      const connectedDevices = await BleClient.getConnectedDevices([ONEKEY_SERVICE_UUID])

      if (connectedDevices.length > 0) {
        const device = connectedDevices[0]
        if (doLog) console.log('OneKeyBLE: [enumerate] Found connected device:', device.deviceId)

        return [{
          id: device.deviceId,
          name: device.name || 'OneKey Device',
          commType: 'ble' as const
        }]
      }

      // Request user to select a device
      if (doLog) console.log('OneKeyBLE: [enumerate] No connected device, requesting selection...')

      const device = await BleClient.requestDevice({
        services: [ONEKEY_SERVICE_UUID],
        optionalServices: [ONEKEY_SERVICE_UUID]
      })

      return [{
        id: device.deviceId,
        name: device.name || 'OneKey Device',
        commType: 'ble' as const
      }]

    } catch (error) {
      console.warn('OneKeyBLE: [enumerate] Cancelled or failed', error)
      return []
    }
  }

  async connect(uuid: string): Promise<void> {
    if (doLog) console.log(`OneKeyBLE: [connect] Connecting to ${uuid}...`)

    if (this.currentDeviceUuid === uuid) {
      if (doLog) console.log('OneKeyBLE: [connect] Already connected')
      return
    }

    // Reset state
    this.bufferLength = 0
    this.buffer = []
    this.runPromise = null
    this.currentDeviceUuid = uuid

    try {
      // === STEP 1: Check and complete bonding BEFORE connecting (Android only) ===
      // This follows the reference project's flow: bond first, then connect
      if (Capacitor.getPlatform() === 'android') {
        await this.ensureBonded(uuid)
      }

      // === STEP 2: Establish GATT connection ===
      if (doLog) console.log('OneKeyBLE: [connect] Establishing GATT connection...')
      await BleClient.connect(uuid, (disconnectedDeviceId) => {
        this.onDisconnect(disconnectedDeviceId)
      }, { timeout: 15000 })

      if (doLog) console.log('OneKeyBLE: [connect] GATT connection established')

      // Wait for connection to stabilize
      if (Capacitor.getPlatform() === 'android') {
        if (doLog) console.log('OneKeyBLE: [connect] Waiting for connection to stabilize...')
        await this.delay(500)
      }

      // === STEP 3: Request high priority (Android) ===
      if (Capacitor.getPlatform() === 'android') {
        try {
          await BleClient.requestConnectionPriority(uuid, 1) // 1 = High
          if (doLog) console.log('OneKeyBLE: [connect] Priority set to High')
        } catch (e) {
          console.warn('OneKeyBLE: [connect] Priority request failed', e)
        }
      }

      // === STEP 4: Discover services ===
      if (doLog) console.log('OneKeyBLE: [connect] Discovering services...')

      const services = await BleClient.getServices(uuid)
      if (doLog) console.log('OneKeyBLE: [connect] Found services:', services.length)

      // Find OneKey service and check characteristic properties
      const onekeyService = services.find(s => s.uuid.toLowerCase() === ONEKEY_SERVICE_UUID.toLowerCase())
      if (onekeyService) {
        if (doLog) {
          console.log('OneKeyBLE: [connect] OneKey service found with characteristics:',
            onekeyService.characteristics?.map(c => c.uuid).join(', '))
        }

        // Check if notify characteristic supports notifications
        const notifyChar = onekeyService.characteristics?.find(
          c => c.uuid.toLowerCase() === ONEKEY_NOTIFY_UUID.toLowerCase()
        )
        if (notifyChar) {
          const props = notifyChar.properties
          const supportsNotify = !!(props?.notify || props?.indicate)
          if (doLog) {
            console.log('OneKeyBLE: [connect] Notify characteristic properties:', JSON.stringify(props))
            console.log('OneKeyBLE: [connect] Supports notify/indicate:', supportsNotify)
          }
        }
      } else {
        console.warn('OneKeyBLE: [connect] OneKey service NOT found!')
      }

      // Wait after service discovery on Android
      if (Capacitor.getPlatform() === 'android') {
        if (doLog) console.log('OneKeyBLE: [connect] Waiting after service discovery...')
        await this.delay(500)
      }

      // === STEP 5: Start notifications with retry mechanism ===
      if (doLog) console.log('OneKeyBLE: [connect] Starting notifications...')

      await this.startNotificationsWithRetry(uuid, 3)

      if (doLog) console.log('OneKeyBLE: [connect] Notifications started successfully!')

    } catch (error) {
      console.error('OneKeyBLE: [connect] FAILED', error)
      this.currentDeviceUuid = null
      throw error
    }
  }

  /**
   * Ensure device is bonded before connecting (Android only)
   * This follows the reference project's flow: bond first, then connect
   */
  private async ensureBonded(uuid: string): Promise<void> {
    try {
      const bonded = await BleClient.isBonded(uuid)
      if (doLog) console.log('OneKeyBLE: [ensureBonded] Device bonded:', bonded)

      if (bonded) {
        if (doLog) console.log('OneKeyBLE: [ensureBonded] Already bonded, proceeding to connect')
        return
      }

      // Device not bonded, initiate bonding
      if (doLog) console.log('OneKeyBLE: [ensureBonded] Device not bonded, initiating pairing...')
      if (doLog) console.log('OneKeyBLE: [ensureBonded] Please complete the pairing dialog on your device (60s timeout)')

      try {
        // Give user enough time to complete system pairing dialog
        await BleClient.createBond(uuid, { timeout: 60000 })
        if (doLog) console.log('OneKeyBLE: [ensureBonded] Pairing completed successfully!')

        // Wait for bonding to fully settle
        await this.delay(1000)

        // Verify bonding succeeded
        const nowBonded = await BleClient.isBonded(uuid)
        if (doLog) console.log('OneKeyBLE: [ensureBonded] Verified bonded status:', nowBonded)

      } catch (bondError: unknown) {
        // Check if it's a timeout or user rejection
        const errorMessage = bondError instanceof Error ? bondError.message : String(bondError)

        if (errorMessage.includes('timeout')) {
          console.warn('OneKeyBLE: [ensureBonded] Pairing timeout - user may not have completed pairing dialog')
          // Check if bonded anyway (user might have completed it after timeout started)
          const bondedAfterTimeout = await BleClient.isBonded(uuid)
          if (bondedAfterTimeout) {
            if (doLog) console.log('OneKeyBLE: [ensureBonded] Device is bonded despite timeout, continuing...')
            return
          }
        }

        console.warn('OneKeyBLE: [ensureBonded] Pairing failed:', bondError)
        console.warn('OneKeyBLE: [ensureBonded] Will try to connect anyway - device might work without explicit bonding')
      }
    } catch (e) {
      console.warn('OneKeyBLE: [ensureBonded] Error checking bond status:', e)
    }
  }

  private async startNotificationsWithRetry(uuid: string, maxRetries: number): Promise<void> {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (doLog && attempt > 1) {
          console.log(`OneKeyBLE: [connect] Retry attempt ${attempt}/${maxRetries}`)
        }

        // Use longer timeout (15s) for startNotifications
        // The default 5s may not be enough if GATT operations are slow
        await BleClient.startNotifications(
          uuid,
          ONEKEY_SERVICE_UUID,
          ONEKEY_NOTIFY_UUID,
          (value: DataView) => {
            this.handleNotification(value)
          },
          { timeout: 15000 }
        )
        return // Success
      } catch (e) {
        lastError = e
        if (attempt < maxRetries) {
          // Wait before retry, with increasing delay
          const delayMs = attempt * 1000
          if (doLog) console.log(`OneKeyBLE: [connect] startNotifications failed, waiting ${delayMs}ms before retry...`, e)
          await this.delay(delayMs)
        }
      }
    }

    throw lastError
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async disconnect(uuid: string): Promise<void> {
    if (doLog) console.log(`OneKeyBLE: [disconnect] ${uuid}`)

    if (this.currentDeviceUuid === uuid) {
      this.currentDeviceUuid = null
    }

    try {
      await BleClient.stopNotifications(uuid, ONEKEY_SERVICE_UUID, ONEKEY_NOTIFY_UUID)
      await BleClient.disconnect(uuid)
      if (doLog) console.log('OneKeyBLE: [disconnect] Success')
    } catch (e) {
      console.warn('OneKeyBLE: [disconnect] Warning:', e)
    }
  }

  async send(uuid: string, data: string): Promise<void> {
    if (!uuid) {
      throw new Error('OneKeyBLE: No device UUID')
    }

    if (doLog) {
      console.log(`OneKeyBLE: [send] Writing ${data.length / 2} bytes`)
      console.log(`OneKeyBLE: [send] HEX: ${data.substring(0, 40)}...`)
    }

    const buffer = hexToDataView(data)

    try {
      await BleClient.writeWithoutResponse(uuid, ONEKEY_SERVICE_UUID, ONEKEY_WRITE_UUID, buffer)
      if (doLog) console.log('OneKeyBLE: [send] Write successful')
    } catch (e) {
      console.error('OneKeyBLE: [send] Write FAILED', e)
      throw e
    }
  }

  async receive(): Promise<string> {
    if (doLog) console.log('OneKeyBLE: [receive] Waiting for data...')

    // Create deferred promise 
    this.runPromise = createDeferred<string>()
    return this.runPromise.promise
  }

  // --- Internal Helpers ---

  private handleNotification(value: DataView): void {
    const data = dataViewToUint8Array(value)
    const hexString = uint8ArrayToHex(data)

    if (doLog) {
      console.log(`OneKeyBLE: [notify] Received ${data.length} bytes: ${hexString.substring(0, 40)}...`)
    }

    // Message reassembly logic
    if (isHeaderChunk(data)) {
      // Read payload length from bytes 5-8 (after 3f 23 23 XX XX)
      this.bufferLength = readInt32BE(data, 5)
      // Start buffer from byte 3 (skip 3f 23 23), keep type + length + payload
      this.buffer = [...data.subarray(3)]

      if (doLog) {
        console.log(`OneKeyBLE: [notify] Header chunk - payload length: ${this.bufferLength}, buffer start: ${this.buffer.length} bytes`)
      }
    } else {
      // Continuation chunk - append entire chunk to buffer
      this.buffer = this.buffer.concat([...data])

      if (doLog) {
        console.log(`OneKeyBLE: [notify] Continuation chunk - buffer now: ${this.buffer.length} bytes`)
      }
    }

    // Check if message is complete
    // buffer contains: type (2) + length (4) + payload
    // COMMON_HEADER_SIZE = 6 = type (2) + length (4)
    if (this.buffer.length - COMMON_HEADER_SIZE >= this.bufferLength) {
      const completeBuffer = new Uint8Array(this.buffer)
      const hexValue = uint8ArrayToHex(completeBuffer)

      if (doLog) {
        console.log(`OneKeyBLE: [notify] Message complete! Total: ${completeBuffer.length} bytes`)
        console.log(`OneKeyBLE: [notify] Complete HEX: ${hexValue.substring(0, 60)}...`)
      }

      // Reset buffer
      this.bufferLength = 0
      this.buffer = []

      // Resolve the pending receive promise
      if (this.runPromise) {
        this.runPromise.resolve(hexValue)
        this.runPromise = null
      }
    }
  }

  private onDisconnect(deviceId: string): void {
    if (doLog) console.log('OneKeyBLE: [EVENT] Disconnected:', deviceId)

    if (this.currentDeviceUuid === deviceId) {
      this.currentDeviceUuid = null
      this.bufferLength = 0
      this.buffer = []

      // Reject any pending receive
      if (this.runPromise) {
        this.runPromise.reject(new Error('Device disconnected'))
        this.runPromise = null
      }
    }
  }
}
