# OneKey BLE Integration Guide

## Quick Summary

The previous implementation failed because it **skipped Android BLE bonding** and had **no retry mechanism**. The fix requires: bond first → connect → discover services → start notifications with retry.

---

## Previous Issues

| Issue | Impact |
|-------|--------|
| No bonding before connect | `startNotifications()` fails silently |
| No service discovery | GATT table not ready |
| No stabilization delays | Race conditions |
| 5s default timeout | Too short for BLE |
| No retry mechanism | Transient failures crash |
| Re-fragmented response | Protocol confusion |

---

## Correct Connection Flow

```
1. ensureBonded(uuid)        // Android: bond first, 60s timeout
2. BleClient.connect()       // 15s timeout
3. delay(500ms)              // Wait for stability
4. getServices()             // Discover & verify OneKey service
5. delay(500ms)              // Wait after discovery
6. startNotifications()      // With 3x retry, 15s timeout each
```

---

## Protocol Format

```
Header:   [3F] [23 23] [TYPE:2] [LENGTH:4 BE] [PAYLOAD...]
Continue: [RAW DATA...]
```

- `0x3F` = Report ID (header only)
- `0x23 0x23` = Magic "##"
- Length is **Big Endian**
- Return **raw reassembled hex**, do NOT re-fragment

---

## Key Code Patterns

### Bonding (Android)

```typescript
const bonded = await BleClient.isBonded(uuid)
if (!bonded) {
  await BleClient.createBond(uuid, { timeout: 60000 })
  await delay(1000)
}
```

### Notifications with Retry

```typescript
for (let i = 1; i <= 3; i++) {
  try {
    await BleClient.startNotifications(uuid, SERVICE, NOTIFY, handler, { timeout: 15000 })
    return
  } catch (e) {
    await delay(i * 1000)
  }
}
```

### Message Reassembly

```typescript
if (isHeader(data)) {  // [3F 23 23 ...]
  length = readInt32BE(data, 5)
  buffer = data.subarray(3)  // Skip 3F 23 23
} else {
  buffer.push(...data)
}

if (buffer.length - 6 >= length) {
  resolve(toHex(buffer))  // Return complete message
}
```

---

## Constants

```typescript
const ONEKEY_SERVICE_UUID = '00000001-0000-1000-8000-00805f9b34fb'
const ONEKEY_WRITE_UUID   = '00000002-0000-1000-8000-00805f9b34fb'
const ONEKEY_NOTIFY_UUID  = '00000003-0000-1000-8000-00805f9b34fb'
```

---

## Android Permissions

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
                 android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

---

## Timeout Reference

| Operation | Timeout |
|-----------|---------|
| Bonding | 60s |
| Connect | 15s |
| Notifications | 15s |
| Post-connect delay | 500ms |
| Post-discovery delay | 500ms |
| Retry backoff | 1s, 2s, 3s |
