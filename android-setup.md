# Android Setup Guide

After running `npx cap add android`, you need to add the following permissions to your AndroidManifest.xml.

## 1. Edit AndroidManifest.xml

File: `android/app/src/main/AndroidManifest.xml`

Add these permissions inside the `<manifest>` tag (before `<application>`):

```xml
<!-- Bluetooth Permissions -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />

<!-- Android 12+ Bluetooth permissions -->
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

<!-- Optional: Only needed if you want to use location-based scanning -->
<!-- <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" /> -->

<!-- BLE feature declaration -->
<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

## 2. Complete Example AndroidManifest.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Bluetooth Permissions -->
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

    <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

    </application>

</manifest>
```

## 3. Build Commands

```bash
# Install dependencies
npm install

# Build the web app
npm run build

# Add Android platform (first time only)
npx cap add android

# Sync changes to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

## 4. Running on Device

1. Connect your Android device via USB
2. Enable Developer Mode and USB Debugging
3. In Android Studio, select your device and click Run

## 5. Troubleshooting

### Device not found after successful BLE connection

This is the issue we're debugging. The BLE adapter connects successfully, but the OneKey SDK
reports "Device not found" (error code 105).

**Root cause**: The message reassembly logic in the BLE adapter was returning HID packets
that didn't start with the correct protocol header.

**Fix**: The updated `OneKeyCapacitorBluetooth.ts` properly handles:
1. Protocol magic detection (`3f2323`)
2. Message length parsing from header
3. Complete message assembly before splitting into HID packets
4. Correct HID packet formatting for SDK consumption

### Bluetooth permissions denied

Make sure you've added all required permissions to AndroidManifest.xml and that the user
has granted Bluetooth permissions when prompted.

### No devices found during scan

1. Make sure your OneKey device is in Bluetooth pairing mode
2. Check that Bluetooth is enabled on your Android device
3. Try toggling Bluetooth off and on
