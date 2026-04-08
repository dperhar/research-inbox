import Cocoa

// Get selected text from the frontmost app via Accessibility API.
// Returns the text on stdout, empty string if nothing selected or AX unavailable.
// Exit code 0 = success (text or empty), 1 = AX not available.

func getSelectedText() -> String? {
    let systemElement = AXUIElementCreateSystemWide()

    var focusedApp: AnyObject?
    let appResult = AXUIElementCopyAttributeValue(systemElement, kAXFocusedApplicationAttribute as CFString, &focusedApp)
    guard appResult == .success, let app = focusedApp else { return nil }

    var focusedElement: AnyObject?
    let elemResult = AXUIElementCopyAttributeValue(app as! AXUIElement, kAXFocusedUIElementAttribute as CFString, &focusedElement)
    guard elemResult == .success, let element = focusedElement else { return nil }

    var selectedText: AnyObject?
    let textResult = AXUIElementCopyAttributeValue(element as! AXUIElement, kAXSelectedTextAttribute as CFString, &selectedText)
    guard textResult == .success, let text = selectedText as? String else { return nil }

    return text.isEmpty ? nil : text
}

if !AXIsProcessTrusted() {
    // No accessibility permission
    exit(1)
}

if let text = getSelectedText() {
    print(text, terminator: "")
    exit(0)
} else {
    // No text selected or AX failed for this app
    exit(0)
}
