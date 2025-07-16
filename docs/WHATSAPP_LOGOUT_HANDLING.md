# WhatsApp Logout Handling

## Overview

This system now properly handles WhatsApp logout scenarios, including both manual logouts and conflicts (like multiple device connections).

## What Happens During Logout

### 1. Automatic Detection

- When Baileys detects a `DisconnectReason.loggedOut`, the system automatically triggers cleanup
- This happens when:
  - User manually logs out from WhatsApp
  - Multiple devices try to connect with the same number (conflict)
  - WhatsApp session expires or is invalidated

### 2. Cleanup Process

When logout is detected, the system:

- **Removes auth credentials** - Deletes the `auth_info_baileys_[userId]` directory
- **Clears state files** - Removes persisted state in `whatsapp-state/`
- **Resets internal state** - Clears QR codes, connection status, target groups
- **Removes service** - Automatically removes the user's service from the service manager

### 3. User Experience

- **Automatic cleanup** - No need to restart the server
- **Fresh start** - Next connection attempt will generate a new QR code
- **No stale data** - All previous session data is cleared

## API Endpoints

### Regular Disconnect

```
POST /api/whatsapp/disconnect
```

- Cleanly closes connection but keeps auth data
- User can reconnect without re-scanning QR code

### Force Logout

```
POST /api/whatsapp/force-logout
```

- Completely removes all auth data and session info
- User will need to scan QR code again
- Use this when experiencing connection issues

## Frontend Features

### Force Logout Button

- Available in the WhatsApp QR code component
- Appears in error states
- Allows users to manually reset their connection

### Auto-Recovery

- System attempts to auto-restore connections on login
- Only generates new QR codes when necessary
- Provides clear feedback about connection state

## Troubleshooting

### Common Issues Fixed:

1. **"Stream Errored (conflict)"** - Now properly handled with automatic cleanup
2. **Stuck in connecting state** - Force logout button allows manual reset
3. **Stale QR codes** - Automatic cleanup ensures fresh QR codes
4. **Service accumulation** - Services are automatically removed on logout

### When to Use Force Logout:

- Connection appears stuck
- Getting conflict errors
- QR code not generating
- After long periods of inactivity
- When switching between devices

## Implementation Details

### Backend (`whatsapp-service.ts`)

- `handleLogout()` - Comprehensive cleanup of auth data and state
- `notifyLogout()` - Callback mechanism to notify service manager
- Automatic file system cleanup

### Service Manager (`whatsapp-service-manager.ts`)

- `handleUserLogout()` - Orchestrates user logout process
- Automatic service removal on logout detection
- Callback-based cleanup to prevent memory leaks

### Frontend (`whatsapp-qr-code.tsx`)

- Force logout button in error states
- Auto-recovery attempt on component mount
- Clear feedback about connection status

## Best Practices

1. **Always handle logout gracefully** - Don't restart the entire server
2. **Clean up auth data** - Remove files to prevent conflicts
3. **Provide user feedback** - Show clear connection states
4. **Enable manual recovery** - Provide force logout option
5. **Track user activity** - Manage service lifecycle properly
