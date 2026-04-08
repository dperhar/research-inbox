#!/usr/bin/env swift
import Vision
import AppKit
import Foundation

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: ocr <image_path>\n", stderr)
    exit(1)
}

let path = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Error: cannot load image at \(path)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en", "ru", "de", "fr", "es", "zh-Hans"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("OCR error: \(error)\n", stderr)
    exit(1)
}

let text = request.results?
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n") ?? ""

print(text)
