import Cocoa

// Strategy 1: CGEvent (works if Input Monitoring is granted)
// Strategy 2: AX menu bar Copy action (works with Accessibility)
// Strategy 3: NSAppleScript keystroke from within this process

let oldCount = NSPasteboard.general.changeCount

// --- Strategy 1: CGEvent ---
func tryCGEvent() -> Bool {
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: true),
          let up = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: false) else { return false }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cgSessionEventTap)
    usleep(30000)
    up.post(tap: .cgSessionEventTap)
    usleep(200000)
    return NSPasteboard.general.changeCount != oldCount
}

// --- Strategy 2: AX menu Copy ---
func tryAXMenuCopy() -> Bool {
    let sys = AXUIElementCreateSystemWide()
    var app: AnyObject?
    guard AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute as CFString, &app) == .success else { return false }

    var bar: AnyObject?
    guard AXUIElementCopyAttributeValue(app as! AXUIElement, kAXMenuBarAttribute as CFString, &bar) == .success else { return false }

    var children: AnyObject?
    guard AXUIElementCopyAttributeValue(bar as! AXUIElement, kAXChildrenAttribute as CFString, &children) == .success,
          let menus = children as? [AXUIElement] else { return false }

    for menu in menus {
        var t: AnyObject?
        AXUIElementCopyAttributeValue(menu, kAXTitleAttribute as CFString, &t)
        let title = t as? String ?? ""
        if ["Edit", "Правка", "Редактирование"].contains(title) {
            AXUIElementPerformAction(menu, kAXPressAction as CFString)
            usleep(150000)
            var sub: AnyObject?
            AXUIElementCopyAttributeValue(menu, kAXChildrenAttribute as CFString, &sub)
            if let subMenu = (sub as? [AXUIElement])?.first {
                var items: AnyObject?
                AXUIElementCopyAttributeValue(subMenu, kAXChildrenAttribute as CFString, &items)
                for item in (items as? [AXUIElement]) ?? [] {
                    var it: AnyObject?
                    AXUIElementCopyAttributeValue(item, kAXTitleAttribute as CFString, &it)
                    let name = it as? String ?? ""
                    if ["Copy", "Копировать"].contains(name) {
                        AXUIElementPerformAction(item, kAXPressAction as CFString)
                        usleep(200000)
                        return NSPasteboard.general.changeCount != oldCount
                    }
                }
            }
            // Close menu
            let esc = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: true)
            esc?.post(tap: .cgSessionEventTap)
            let escUp = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: false)
            escUp?.post(tap: .cgSessionEventTap)
            break
        }
    }
    return false
}

// --- Strategy 3: NSAppleScript ---
func tryAppleScript() -> Bool {
    let script = NSAppleScript(source: """
        tell application "System Events" to keystroke "c" using command down
    """)
    script?.executeAndReturnError(nil)
    usleep(200000)
    return NSPasteboard.general.changeCount != oldCount
}

// Try all strategies in order
if tryCGEvent() { exit(0) }
if tryAXMenuCopy() { exit(0) }
if tryAppleScript() { exit(0) }
exit(1) // All failed
