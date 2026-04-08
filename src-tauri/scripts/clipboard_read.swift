import Cocoa

// Reads clipboard content: text + images.
// Outputs JSON to stdout:
//   {"text": "...", "image_paths": ["/path1.png", ...], "html": "..."}
//
// Image sources (checked in order):
// 1. Raw image data on clipboard (PNG/TIFF — from screenshots, image copies)
// 2. HTML clipboard with <img> tags — downloads images from URLs
// 3. File URLs on clipboard pointing to images

let pb = NSPasteboard.general
let fm = FileManager.default

let imageDir: String
if CommandLine.arguments.count > 1 {
    imageDir = CommandLine.arguments[1]
} else {
    let home = fm.homeDirectoryForCurrentUser.path
    imageDir = "\(home)/.research-inbox/images"
}
try? fm.createDirectory(atPath: imageDir, withIntermediateDirectories: true)

// Read plain text
let text = pb.string(forType: .string) ?? ""

// Read HTML
let html = pb.string(forType: .html) ?? ""

var imagePaths: [String] = []

// --- Source 1: Raw image data (PNG, TIFF) ---
if let imgData = pb.data(forType: .png) {
    let path = "\(imageDir)/\(UUID().uuidString).png"
    try? imgData.write(to: URL(fileURLWithPath: path))
    imagePaths.append(path)
} else if let imgData = pb.data(forType: .tiff) {
    if let rep = NSBitmapImageRep(data: imgData),
       let png = rep.representation(using: .png, properties: [:]) {
        let path = "\(imageDir)/\(UUID().uuidString).png"
        try? png.write(to: URL(fileURLWithPath: path))
        imagePaths.append(path)
    }
}

// --- Source 2: HTML with <img> tags — download images ---
if !html.isEmpty && imagePaths.isEmpty {
    // Extract img src URLs from HTML
    let imgPattern = try? NSRegularExpression(pattern: #"<img[^>]+src\s*=\s*"([^"]+)"#, options: .caseInsensitive)
    let matches = imgPattern?.matches(in: html, range: NSRange(html.startIndex..., in: html)) ?? []

    let semaphore = DispatchSemaphore(value: 0)
    var downloadCount = 0
    let maxImages = 5 // cap to avoid downloading 50 thumbnails

    for match in matches.prefix(maxImages) {
        if let range = Range(match.range(at: 1), in: html) {
            var urlStr = String(html[range])

            // Skip tiny tracking pixels and data URIs
            if urlStr.hasPrefix("data:") { continue }
            if urlStr.contains("1x1") || urlStr.contains("pixel") || urlStr.contains("spacer") { continue }

            // Make absolute if relative
            if urlStr.hasPrefix("//") { urlStr = "https:" + urlStr }

            guard let url = URL(string: urlStr) else { continue }

            downloadCount += 1
            let task = URLSession.shared.dataTask(with: url) { data, response, error in
                defer { semaphore.signal() }
                guard let data = data, data.count > 1000 else { return } // skip tiny images (<1KB)

                // Determine extension from content type or URL
                let ext = url.pathExtension.isEmpty ? "png" : url.pathExtension.lowercased()
                let validExt = ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains(ext) ? ext : "png"

                // Convert to PNG for consistency
                if let image = NSImage(data: data),
                   let tiff = image.tiffRepresentation,
                   let rep = NSBitmapImageRep(data: tiff),
                   let pngData = rep.representation(using: .png, properties: [:]) {
                    let path = "\(imageDir)/\(UUID().uuidString).png"
                    try? pngData.write(to: URL(fileURLWithPath: path))
                    imagePaths.append(path)
                }
            }
            task.resume()
        }
    }

    // Wait for all downloads (max 3 seconds total)
    for _ in 0..<downloadCount {
        _ = semaphore.wait(timeout: .now() + 3.0)
    }
}

// --- Output JSON ---
func escapeJSON(_ s: String) -> String {
    return s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
}

let pathsJSON = imagePaths.map { "\"\(escapeJSON($0))\"" }.joined(separator: ",")
print("{\"text\":\"\(escapeJSON(text))\",\"image_paths\":[\(pathsJSON)]}")
