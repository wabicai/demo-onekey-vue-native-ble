import {
  dataViewToHex,
  hexToDataView
}                             from '@eternl/lib/base/hex'

import {
  LowlevelTransportSharedPlugin
}                             from '@onekeyfe/hd-transport'

import { BleClient }          from '@capacitor-community/bluetooth-le'
import { Capacitor }          from '@capacitor/core'


const doLog                   = true

// OneKey Service & Characteristic UUIDs
const ONEKEY_SERVICE_UUID     = '00000001-0000-1000-8000-00805f9b34fb'
const ONEKEY_WRITE_UUID       = '00000002-0000-1000-8000-00805f9b34fb'
const ONEKEY_NOTIFY_UUID      = '00000003-0000-1000-8000-00805f9b34fb'

const PROTOCOL_MAGIC          = '2323'  // '2323' (##) is the standard for OneKey/Trezor Connect.
const HEADER_SIZE_BYTES       = 8       // Magic (2) + Type (2) + Length (4)
const HID_PACKET_SIZE         = 64
const HID_PAYLOAD_SIZE        = 63 // 1 byte for Report ID (3f)

export class OneKeyCapacitorBluetooth implements LowlevelTransportSharedPlugin {

  version                     = '1.0.0'

  private currentDeviceUuid   = <string | null>null

  // Buffer to hold raw hex chunks until a full message is assembled
  private incomingBuffer      = ''

  // Queue of fully assembled messages ready for the SDK to consume
  private messageQueue        = <string[]>[]

  private resolveReceive      = <((value: string) => void) | null>null

  constructor() {}            // initialization happens in init()

  async init() {

    if (doLog) { console.log('OneKeyBLE: [init] Initializing with androidNeverForLocation: true') }

    try {

      // 1. Initialize AND Request Permissions
      // The 'androidNeverForLocation' flag maps to the permission flag we set in Manifest.
      await BleClient.initialize({ androidNeverForLocation: true })

      if (doLog) { console.log('OneKeyBLE: [init] BleClient.initialize success') }

      // 2. Double check (Optional but recommended)
      // Some devices might still need an explicit check if the above doesn't trigger it
      if (Capacitor.getPlatform() === 'android') {

        const isEnabled       = await BleClient.isEnabled()

        if (doLog) { console.log('OneKeyBLE: [init] Bluetooth enabled:', isEnabled) }

        if (!isEnabled) {
          // This triggers the system dialog to turn on Bluetooth if it's off
          // It does NOT ask for the SCAN permission, but ensures the radio is on.
          await BleClient.requestEnable()
        }
      }

    } catch (error) {

      console.error('OneKeyBLE: [init] FAILED', error)
      throw error
    }
  }

  async enumerate() {

    if (doLog) { console.log('OneKeyBLE: [enumerate] Scanning...') }

    try {

      // 1. Check native system for active connections first
      // This returns immediately with no UI if the device is already connected.
      const connectedDevices  = await BleClient.getConnectedDevices([ONEKEY_SERVICE_UUID])

      if (connectedDevices.length > 0) {

        const device          = connectedDevices[0]

        if (doLog) { console.log('OneKeyBLE: [enumerate] Found connected device:', device.deviceId) }

        return [{
          id:                 device.deviceId,
          name:               device.name || 'OneKey Device',
          commType:           'ble' as const,
          ...device
        }]
      }

      // 2. Only if no device is found, ask the user to pick one
      // This will trigger the system pairing popup.
      if (doLog) { console.log('OneKeyBLE: [enumerate] No connected device, requesting user selection...') }

      const device = await BleClient.requestDevice({
        services:             [ONEKEY_SERVICE_UUID],
        optionalServices:     [ONEKEY_SERVICE_UUID]
      })

      return [{
        id:                   device.deviceId,
        name:                 device.name || 'OneKey Device',
        commType:             'ble' as const,
        ...device
      }]

    } catch (error) {
      console.warn('OneKeyBLE: [enumerate] Cancelled or failed', error)
      return []
    }
  }

  async connect(uuid: string) {

    if (doLog) { console.log(`OneKeyBLE: [connect] Connecting to ${uuid}...`) }

    // If already connected to this UUID, just return
    if (this.currentDeviceUuid === uuid) {

      if (doLog) { console.log('OneKeyBLE: [connect] Already connected') }

      return
    }

    // reset buffer
    this.incomingBuffer       = ''
    this.messageQueue         = []
    this.currentDeviceUuid    = uuid

    try {

      await BleClient.connect(uuid, (disconnectedDeviceId) => this.onDisconnect(disconnectedDeviceId))

      if (doLog) { console.log('OneKeyBLE: [connect] Connection established') }

      // Note: Android MTU 512 negotiation is handled automatically by the plugin.

      // Android optimization: Request High Priority (Low Latency)
      if (Capacitor.getPlatform() === 'android') {

        try {

          await BleClient.requestConnectionPriority(uuid, 1) // 1 = High

          if (doLog) { console.log('OneKeyBLE: [connect] Priority set to High') }

        } catch (e) {

          console.warn('OneKeyBLE: [connect] Priority request failed', e)
        }
      }

      if (doLog) { console.log('OneKeyBLE: [connect] Starting notifications...') }

      await BleClient.startNotifications(
        uuid,
        ONEKEY_SERVICE_UUID,
        ONEKEY_NOTIFY_UUID,
        (value: DataView) => {
          this.handleNotification(value)
        }
      )

      if (doLog) { console.log('OneKeyBLE: [connect] Notifications started successfully') }

    } catch (error) {

      console.error('OneKeyBLE: [connect] FAILED', error)
      throw error
    }
  }

  async disconnect(uuid: string) {

    if (doLog) { console.log(`OneKeyBLE: [disconnect] ${uuid}`) }

    // Clear device UUID on explicit disconnect
    if (this.currentDeviceUuid === uuid) {

      this.currentDeviceUuid  = null
    }

    try {

      // Stop notifications first to be clean
      await BleClient.stopNotifications(uuid, ONEKEY_SERVICE_UUID, ONEKEY_NOTIFY_UUID)
      await BleClient.disconnect(uuid)

      if (doLog) { console.log('OneKeyBLE: [disconnect] Success') }

    } catch (e) {

      // Start/Stop notifications might fail if device is already disconnected
      console.warn('OneKeyBLE: [disconnect] Warning:', e)
    }
  }

  async send(uuid: string, data: string) {

    if (!uuid) {

      console.error('OneKeyBLE: [send] No UUID provided')
      throw 'OneKeyBLE: No device UUID'
    }

    if (doLog) {

      console.log(`OneKeyBLE: [send] Writing ${data.length / 2} bytes...`)
      // Log full hex to inspect exact payload structure
      console.log(`OneKeyBLE: [send] RAW HEX: ${data}`)
    }

    const buffer              = hexToDataView(data)

    try {

      // Use writeWithoutResponse for hardware wallets to prevent ACK lag
      await BleClient.writeWithoutResponse(uuid, ONEKEY_SERVICE_UUID, ONEKEY_WRITE_UUID, buffer)

      if (doLog) { console.log('OneKeyBLE: [send] Write successful') }

    } catch (e) {

      console.error('OneKeyBLE: [send] Write FAILED', e)
      throw e
    }
  }

  async receive(): Promise<string> {

    // 1. If we have a full message ready, return it immediately
    if (this.messageQueue.length > 0) {

      const data              = this.messageQueue.shift()!

      if (doLog) {

        console.log(`OneKeyBLE: [receive] Returning queued message (${data.length / 2} bytes)`)
        // Log full hex to inspect exact payload structure
        console.log(`OneKeyBLE: [receive] RAW HEX: ${data}`)
      }

      return data
    }

    if (doLog) { console.log('OneKeyBLE: [receive] Waiting for complete message...') }

    // 2. Wait for the reassembly logic to finish a message
    return new Promise<string>((resolve) => {

      this.resolveReceive     = resolve
    })
  }

  // --- Internal Helpers ---
  private handleNotification(value: DataView) {

    let hex                   = dataViewToHex(value)

    if (doLog) { console.log(`OneKeyBLE: [buffer] RAW Chunk (${value.byteLength} bytes): ${hex.substring(0, 20)}...`) }

    // --- 1. Strip Initial Report ID (if present) ---
    // The device sends '3f' at the start of the stream, but not on subsequent BLE packets.
    // We want a clean stream starting with the Magic '2323'.
    if (hex.startsWith(`3f${PROTOCOL_MAGIC}`)) {

      hex                     = hex.substring(2)
    }

    // --- 2. Buffer Data ---
    this.incomingBuffer       += hex

    if (doLog) { console.log(`OneKeyBLE: [buffer] Current Buffer Length: ${this.incomingBuffer.length / 2} bytes`) }

    // --- 3. Reassembly Loop ---
    // Try to extract as many full messages as possible from the buffer
    while (true) {

      // We need at least the header (8 bytes = 16 hex chars) to know the length
      if (this.incomingBuffer.length < (HEADER_SIZE_BYTES * 2)) { break } // Not enough data for header

      // Verify Magic (sanity check)
      if (!this.incomingBuffer.startsWith(PROTOCOL_MAGIC)) {

        console.error('OneKeyBLE: [buffer] Stream out of sync! Resetting buffer.')

        // Log the corrupt buffer to help identify why it's out of sync
        if (doLog) { console.log(`OneKeyBLE: [buffer] Corrupt Buffer Dump: ${this.incomingBuffer}`) }

        this.incomingBuffer   = '' // Fatal error, dump buffer
        break
      }

      // Parse Length from Header
      // Header: [Magic: 2] [Type: 2] [Length: 4]
      // Hex indices: Magic(0-4), Type(4-8), Length(8-16)
      const lengthHex         = this.incomingBuffer.substring(8, 16)
      const payloadBytes      = parseInt(lengthHex, 16)

      // Total expected size = Header (8) + Payload
      const totalBytes        = HEADER_SIZE_BYTES + payloadBytes
      const totalHexChars     = totalBytes * 2

      if (doLog) { console.log(`OneKeyBLE: [parser] Header Check - Length: ${payloadBytes}, Total Expected: ${totalBytes}`) }

      // Check if we have the full message
      if (this.incomingBuffer.length >= totalHexChars) {

        // Extract the full message
        let fullMessage       = this.incomingBuffer.substring(0, totalHexChars)

        // Remove it from the buffer
        this.incomingBuffer   = this.incomingBuffer.substring(totalHexChars)

        if (doLog) { console.log(`OneKeyBLE: [buffer] Assembled message ${totalBytes} bytes (Payload: ${payloadBytes})`) }

        // The SDK expects the raw packet format, including the Report ID (3f).
        // Since we stripped it earlier to process the buffer, we must add it back now.
        // Fragment into 64-byte HID Packets
        while (fullMessage.length > 0) {

          // Take a chunk of up to 63 bytes (126 hex chars)
          const chunkLength   = Math.min(fullMessage.length, HID_PAYLOAD_SIZE * 2)
          let chunk           = fullMessage.substring(0, chunkLength)
          fullMessage         = fullMessage.substring(chunkLength)

          // Prepend Report ID '3f'
          let packet          = '3f' + chunk

          // Pad with '00' if packet is shorter than 64 bytes
          // (HID reports usually must be fixed size)
          while (packet.length < (HID_PACKET_SIZE * 2)) {

            packet            += '00'
          }

          // Enqueue this packet
          if (this.resolveReceive) {

            this.resolveReceive(packet)
            this.resolveReceive = null

          } else {

            this.messageQueue.push(packet)
          }
        }

      } else {

        // Wait for more data
        if (doLog) { console.log(`OneKeyBLE: [buffer] Partial message. Have ${this.incomingBuffer.length/2}/${totalBytes} bytes`) }
        break
      }
    }
  }

  private onDisconnect(deviceId: string) {

    if (doLog) { console.log('OneKeyBLE: [EVENT] Device disconnected:', deviceId) }

    if (this.currentDeviceUuid === deviceId) {

      this.currentDeviceUuid  = null
      this.resolveReceive     = null
      this.incomingBuffer     = ''
    }
  }
}
