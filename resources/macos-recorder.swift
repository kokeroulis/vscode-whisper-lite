import AVFoundation
import Foundation

guard CommandLine.arguments.count == 2 else {
  fputs("Usage: macos-recorder.swift <output-file>\n", stderr)
  exit(2)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = outputURL.deletingLastPathComponent()

try FileManager.default.createDirectory(
  at: outputDirectory,
  withIntermediateDirectories: true
)

if #available(macOS 10.14, *) {
  let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)

  if authorizationStatus == .denied || authorizationStatus == .restricted {
    fputs("Microphone permission denied for this process.\n", stderr)
    exit(3)
  }

  if authorizationStatus == .notDetermined {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    AVCaptureDevice.requestAccess(for: .audio) { allowed in
      granted = allowed
      semaphore.signal()
    }

    semaphore.wait()

    if !granted {
      fputs("Microphone permission was not granted.\n", stderr)
      exit(3)
    }
  }
}

let settings: [String: Any] = [
  AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
  AVSampleRateKey: 16_000,
  AVNumberOfChannelsKey: 1,
  AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
]

let recorder = try AVAudioRecorder(url: outputURL, settings: settings)

guard recorder.record() else {
  fputs("Could not start AVAudioRecorder.\n", stderr)
  exit(4)
}

_ = readLine()
recorder.stop()
