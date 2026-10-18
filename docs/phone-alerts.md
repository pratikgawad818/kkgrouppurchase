# Phone alerts

Open the bell in the signed-in ERP. The Phone alerts section shows the current device's status.

- **Turn on phone alerts** asks permission from an explicit tap and registers the device for the signed-in staff account.
- **Send test** sends one ordinary visible test alert only to this device. It does not create a purchase/payment/demo record. Repeated tests are limited to one per 30 seconds per registered device.
- **Repair alerts** renews a broken endpoint. Routine workspace entry and focus reuse healthy subscriptions.
- **Turn off** stops this browser's subscription and remembers the choice per staff account on this device.
- **Manage devices** lists the signed-in account's registrations; remove old ones to free the existing ten-device limit. Removing a registration is reversible by enabling alerts again on that device.
- Signing out detaches this browser subscription. If the browser/network refuses cleanup, a visible warning explains how to block site notifications on a shared phone.

On iPhone/iPad, add the ERP to the Home Screen, launch that icon and enable alerts there. On Android, allow notifications for the browser/site and allow background activity. The phone's own silent mode, notification permissions, network, battery and background restrictions can still delay or suppress presentation.

Provider acceptance is not proof of display on the phone: verify the test in the device's notification tray and tap it. Do not use financial approval actions to test notifications.

## Delivery and security

The push worker is the sole OS notification path. Realtime only refreshes the in-app inbox, avoiding duplicate banners and the unsupported mobile Notification constructor. Existing notification IDs remain the deduplication tags. Taps reuse a window or fall back to a new one, with same-origin destinations only.

Delivery runs concurrently for at most ten owned endpoints. Each request has a five-second timeout, manual redirects, and one retry only for an explicit temporary 429/5xx rejection. Ambiguous timeouts are not automatically resent. The database dispatch timeout is fifteen seconds. Expired 404/410 endpoints are removed from the subscription register.

The self-test requires an authenticated active staff account, claims only that user's exact endpoint atomically, and never returns keys or sends to other users. Existing RLS, notification recipients, business records and credentials are unchanged.

Migration: `0044_push_device_test.sql` adds a nullable test-throttle timestamp and adjusts the existing trigger's HTTP timeout. No new client update privilege is granted.
