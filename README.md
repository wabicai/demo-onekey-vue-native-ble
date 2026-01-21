# OneKey BLE Demo (Vue + Capacitor)

A demo project for connecting OneKey hardware wallets via Bluetooth using Vue 3 + Capacitor.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build web app
pnpm run build

# Add Android platform (first time only)
npx cap add android

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

## Android Setup

After adding Android platform, edit `android/app/src/main/AndroidManifest.xml` to add Bluetooth permissions:

```xml
<!-- Add inside <manifest> before <application> -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

See [android-setup.md](./android-setup.md) for complete configuration.

## Architecture

```
Vue App
  └── useOneKeyDevice.ts (composable)
        └── @onekeyfe/hd-common-connect-sdk
              └── OneKeyCapacitorBluetooth.ts (custom adapter)
                    └── @capacitor-community/bluetooth-le
```

## Implementation Details

### Protocol Format (Over BLE)

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Magic (3B)  │  Type (2B)   │ Length (4B)  │   Payload    │
│  0x3f 23 23  │  Big-Endian  │  Big-Endian  │   Variable   │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- **Magic**: `0x3f 0x23 0x23` = `?##` (3 bytes)
- **Type**: Message type, big-endian (2 bytes)
- **Length**: Payload length, big-endian (4 bytes)
- **Payload**: Protobuf-encoded message data

### Message Reassembly

BLE MTU is typically 20-512 bytes, so messages are split across multiple BLE notifications.

```typescript
// Check if chunk is a header (starts with 3f 23 23)
function isHeaderChunk(data: Uint8Array): boolean {
  return data[0] === 0x3f && data[1] === 0x23 && data[2] === 0x23
}

// Reassembly logic
if (isHeaderChunk(data)) {
  bufferLength = readInt32BE(data, 5)  // Read length at offset 5
  buffer = [...data.subarray(3)]        // Skip first 3 bytes (magic)
} else {
  buffer = buffer.concat([...data])     // Append continuation
}

// Check completion (COMMON_HEADER_SIZE = 6 = type(2) + length(4))
if (buffer.length - 6 >= bufferLength) {
  // Message complete!
}
```

### Key Differences from HID

| HID (USB/Desktop) | BLE (Mobile) |
|-------------------|--------------|
| Fixed 64-byte packets | Variable-length chunks |
| Each packet has `3f` prefix | Only header chunk has magic |
| Pad to 64 bytes | No padding needed |

## Project Structure

```
vue-ble-demo/
├── src/
│   ├── lib/
│   │   ├── OneKeyCapacitorBluetooth.ts  # BLE adapter
│   │   └── debug-protocol.ts            # Protocol debugger
│   ├── composables/
│   │   └── useOneKeyDevice.ts           # OneKey Vue composable
│   ├── App.vue                          # Test UI
│   └── main.ts
├── package.json
├── capacitor.config.ts
├── vite.config.ts
└── android-setup.md
```

## Debugging

Open browser DevTools console and run:

```javascript
// Analyze a BLE packet
oneKeyDebug.parseHidPacket('3f2323001100000160...')

// Check if hex string is a header chunk
oneKeyDebug.isHeaderChunk('3f2323001100000160...')

// Simulate message reassembly
oneKeyDebug.simulateReassembly([
  '3f2323001100000160...',  // Header chunk
  'abcdef123456...',         // Continuation
])

// Run full diagnostics
oneKeyDebug.runDiagnostics()
```

## References

- [OneKey Hardware JS SDK](https://github.com/AstroxNetwork/hardware-js-sdk)
- [native-android-example](https://github.com/AstroxNetwork/hardware-js-sdk/tree/main/packages/connect-examples/native-android-example) - Reference implementation using `hd-common-connect-sdk`
- [Capacitor Bluetooth LE](https://github.com/capacitor-community/bluetooth-le)

## License

MIT
