import Cocoa

// Triggers the macOS Input Monitoring permission prompt.
// Creating a CGEventTap (even a passive one) causes macOS to show
// "App wants to monitor input" dialog and adds the app to the list.

let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
    callback: { _, _, event, _ in Unmanaged.passRetained(event) },
    userInfo: nil
)

if tap != nil {
    // Success — macOS will have prompted or added us to Input Monitoring
    // Clean up immediately, we don't actually need to monitor
} else {
    // tap is nil = permission was denied or not yet granted
    // macOS should have shown the prompt dialog
}
