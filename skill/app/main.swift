// Enhance Prompt helper app: hosts the popup (input) and the result window for the
// /enhance-prompt skill. It only runs while one of its windows is open.
//
//   EnhancePrompt popup  --ui DIR --job DIR --state FILE --draft DIR
//   EnhancePrompt result --ui DIR --record FILE --version N
//   test options: --test-js FILE (run JS after load), --snapshot PNG (save a picture and quit)
import AppKit
import WebKit
import ApplicationServices
import Speech
import AVFoundation
import QuartzCore

// MARK: - arguments
let argv = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = argv.firstIndex(of: name), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
let mode = argv.count > 1 ? argv[1] : "popup"
let uiDir = URL(fileURLWithPath: arg("--ui") ?? "")
let fm = FileManager.default
let home = fm.homeDirectoryForCurrentUser
let dataRoot = home.appendingPathComponent(".claude/prompt-enhancer").standardizedFileURL.path

func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }
func readJSON(_ path: String) -> [String: Any]? {
    guard let d = fm.contents(atPath: path) else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}
func writeJSON(_ obj: Any, _ path: String) -> Bool {
    guard let d = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) else { return false }
    let tmp = path + ".tmp"
    do { try d.write(to: URL(fileURLWithPath: tmp)); _ = try? fm.removeItem(atPath: path); try fm.moveItem(atPath: tmp, toPath: path); return true } catch { return false }
}
func dataFromDataURL(_ s: String) -> Data? {
    guard let comma = s.firstIndex(of: ",") else { return nil }
    return Data(base64Encoded: String(s[s.index(after: comma)...]))
}
let imageExts: Set<String> = ["png", "jpg", "jpeg", "gif", "heic", "heif", "tif", "tiff", "bmp", "webp"]

// Files the page may load through pe://file/… : our data folder plus files the user picked or pasted.
var allowedFiles = Set<String>()
func fileURLString(_ path: String) -> String {
    allowedFiles.insert(URL(fileURLWithPath: path).standardizedFileURL.path)
    var comps = URLComponents(); comps.scheme = "pe"; comps.host = "file"; comps.path = URL(fileURLWithPath: path).standardizedFileURL.path
    return comps.url!.absoluteString
}

// MARK: - pe:// scheme (pages and local images)
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path: String
        if url.host == "ui" {
            let rel = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
            path = uiDir.appendingPathComponent(rel).standardizedFileURL.path
            if !path.hasPrefix(uiDir.standardizedFileURL.path) { fail(task); return }
        } else if url.host == "file" {
            path = URL(fileURLWithPath: url.path).standardizedFileURL.path
            if !(path.hasPrefix(dataRoot + "/") || allowedFiles.contains(path)) { fail(task); return }
        } else { fail(task); return }
        guard let data = fm.contents(atPath: path) else { fail(task); return }
        let ext = (path as NSString).pathExtension.lowercased()
        let types: [String: String] = ["html": "text/html", "js": "text/javascript", "css": "text/css", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "heic": "image/heic", "tif": "image/tiff", "tiff": "image/tiff", "bmp": "image/bmp", "svg": "image/svg+xml"]
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": types[ext] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"])!
        task.didReceive(resp); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    private func fail(_ task: WKURLSchemeTask) { task.didFailWithError(NSError(domain: "pe", code: 404)) }
}

// MARK: - windows
final class PopupWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var hitRects: [NSRect] = []
    var mouseTimer: Timer?
    var dragMonitor: Any?
    var zoomTimer: Timer?
    var zoomRestore: NSRect?       // the result window's size before it was zoomed
    var finished = false
    var closingAllowed = false
    var signalSource: DispatchSourceSignal?
    let jobDir = arg("--job") ?? ""
    let draftDir = arg("--draft") ?? ""
    var pasteCount = 0

    func applicationDidFinishLaunching(_ n: Notification) {
        // Red underline for spelling mistakes in the text boxes (WebKit reads this app setting).
        UserDefaults.standard.set(true, forKey: "WebContinuousSpellCheckingEnabled")
        UserDefaults.standard.set(true, forKey: "WebKitTextCheckingEnabled")
        buildMenu()
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "pe")
        cfg.userContentController.add(self, name: "bridge")
        let screen = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        if mode == "result" {
            let w = min(1000, screen.width - 60), h = min(720, screen.height - 60)
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h), styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.minSize = NSSize(width: 640, height: 480)
            window.title = "Enhanced prompt"
            // Newly uncovered edges during a resize show the page colour, not a flash of another colour.
            window.backgroundColor = NSColor(name: nil) { ap in
                ap.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0x2f / 255.0, green: 0x2f / 255.0, blue: 0x2f / 255.0, alpha: 1)
                                                                    : NSColor(srgbRed: 0xfa / 255.0, green: 0xfa / 255.0, blue: 0xfa / 255.0, alpha: 1) }
            window.center()
        } else {
            // A transparent window over the whole screen: the prompt box moves inside it and the image editor
            // opens inside it, so nothing ever waits for the window to change size. Clicks outside the box pass through.
            window = PopupWindow(contentRect: screen, styleMask: [.borderless], backing: .buffered, defer: false)
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = false
            window.level = .floating
            window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        }
        window.delegate = self
        window.isReleasedWhenClosed = false
        web = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        if mode == "result" { web.underPageBackgroundColor = window.backgroundColor } else { web.setValue(false, forKey: "drawsBackground") }
        if #available(macOS 13.3, *) { web.isInspectable = true }
        window.contentView!.addSubview(web)
        web.load(URLRequest(url: URL(string: "pe://ui/" + (mode == "result" ? "result.html" : "popup.html"))!))
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)

        if mode != "result" {
            // Clicks outside the prompt box go to the apps behind the popup.
            mouseTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.updateMouse() }
            // No time limit: the popup stays open until you close or send it. The skill's helper
            // touches a "heartbeat" file while it waits; if Claude's run is stopped (stop file, or no
            // heartbeat for 3 minutes), the popup closes and keeps your draft.
            if !jobDir.isEmpty {
                try? "\(getpid())".write(toFile: (jobDir as NSString).appendingPathComponent("app.pid"), atomically: true, encoding: .utf8)
                let started = Date()
                Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                    guard let self = self, !self.finished else { return }
                    let stop = (self.jobDir as NSString).appendingPathComponent("stop")
                    let hb = (self.jobDir as NSString).appendingPathComponent("heartbeat")
                    var stale = false
                    if let a = try? fm.attributesOfItem(atPath: hb), let m = a[.modificationDate] as? Date { stale = Date().timeIntervalSince(m) > 180 }
                    else { stale = Date().timeIntervalSince(started) > 60 }
                    if fm.fileExists(atPath: stop) || stale { self.web.evaluateJavaScript("window.__popup && window.__popup.cancel()"); DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.finish("cancelled", 3) } }
                }
            }
            // A second /enhance-prompt brings this one to the front.
            signal(SIGUSR1, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
            src.setEventHandler { [weak self] in NSApp.activate(ignoringOtherApps: true); self?.window.makeKeyAndOrderFront(nil) }
            src.resume(); signalSource = src
        }
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z"); redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = main
    }

    func updateMouse() {
        guard let w = window, w.isVisible else { return }
        let p = NSEvent.mouseLocation
        let local = NSPoint(x: p.x - w.frame.minX, y: w.frame.height - (p.y - w.frame.minY))
        let inside = hitRects.contains { $0.contains(local) }
        // While a mouse button is held (selecting text, dragging the handle), keep the clicks here,
        // even if the mouse leaves the box; otherwise the release is lost and the selection keeps growing.
        if dragMonitor != nil && NSEvent.pressedMouseButtons & 1 == 0 { stopWindowDrag() }   // a missed release
        if !inside && !w.ignoresMouseEvents && (NSEvent.pressedMouseButtons != 0 || dragMonitor != nil) { return }
        if w.ignoresMouseEvents == inside { w.ignoresMouseEvents = !inside }
    }

    // Moves the window while the mouse button is held (started from the handle at the top).
    func startWindowDrag() {
        guard let w = window, dragMonitor == nil, NSEvent.pressedMouseButtons & 1 != 0 else { return }
        let start = NSEvent.mouseLocation; let origin = w.frame.origin
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] ev in
            guard let self = self, let w = self.window else { return ev }
            if ev.type == .leftMouseUp || NSEvent.pressedMouseButtons & 1 == 0 { self.stopWindowDrag(); return ev }
            let p = NSEvent.mouseLocation
            w.setFrameOrigin(self.keepOnScreen(NSPoint(x: origin.x + p.x - start.x, y: origin.y + p.y - start.y), w))
            return ev
        }
    }
    func stopWindowDrag() { if let m = dragMonitor { NSEvent.removeMonitor(m) }; dragMonitor = nil }

    // Zoom (double-click on the handle, or the green button): fills the screen, and back.
    // macOS's own zoom animation blocks the page: it gets no new size until the end, then jumps.
    // So the window is moved here frame by frame, with the same timing as macOS; the page follows every step.
    func animateZoom() {
        guard let w = window else { return }
        let scr = (w.screen ?? NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let f = w.frame
        let zoomed = abs(f.minX - scr.minX) < 2 && abs(f.minY - scr.minY) < 2 && abs(f.width - scr.width) < 2 && abs(f.height - scr.height) < 2
        let target: NSRect
        if zoomed {
            let w0 = min(1000, scr.width - 60), h0 = min(720, scr.height - 60)
            target = zoomRestore ?? NSRect(x: scr.midX - w0 / 2, y: scr.midY - h0 / 2, width: w0, height: h0)
            zoomRestore = nil
        } else { zoomRestore = f; target = scr }
        let start = f
        let duration = max(0.18, w.animationResizeTime(target))
        let t0 = CACurrentMediaTime()
        zoomTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] tm in
            let p = min(1, (CACurrentMediaTime() - t0) / duration)
            let e = p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2      // ease in and out
            func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * CGFloat(e) }
            w.setFrame(NSRect(x: mix(start.minX, target.minX), y: mix(start.minY, target.minY),
                              width: mix(start.width, target.width), height: mix(start.height, target.height)), display: true)
            if p >= 1 { tm.invalidate(); self?.zoomTimer = nil }
        }
        RunLoop.main.add(timer, forMode: .common)
        zoomTimer = timer
    }
    func windowShouldZoom(_ window: NSWindow, toFrame newFrame: NSRect) -> Bool {
        if mode == "result" { animateZoom(); return false }
        return true
    }
    // Keeps the result window on the screen while it is dragged by its handle.
    func keepOnScreen(_ o: NSPoint, _ w: NSWindow) -> NSPoint {
        let scr = (w.screen ?? NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let h = w.frame.height
        let part = NSRect(x: 0, y: 0, width: w.frame.width, height: h)
        var x = o.x, y = o.y
        if x + part.minX < scr.minX { x = scr.minX - part.minX }
        if x + part.maxX > scr.maxX { x = scr.maxX - part.maxX }
        if y + h - part.maxY < scr.minY { y = scr.minY - h + part.maxY }
        if y + h - part.minY > scr.maxY { y = scr.maxY - h + part.minY }   // the top always stays reachable
        return NSPoint(x: x, y: y)
    }

    // MARK: test hooks
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let js = arg("--test-js"), let code = try? String(contentsOfFile: js, encoding: .utf8) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { webView.evaluateJavaScript(code) { r, e in log("test-js: \(String(describing: r)) \(e.map { "\($0)" } ?? "")") } }
        }
        if let snap = arg("--snapshot") {
            let delay = Double(arg("--snapshot-delay") ?? "2.5") ?? 2.5
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                webView.takeSnapshot(with: nil) { img, _ in
                    if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: snap))
                    }
                    func hasDictation(_ m: NSMenu) -> Bool { m.items.contains { ($0.action.map(NSStringFromSelector) == "startDictation:") || ($0.submenu.map(hasDictation) ?? false) } }
                    log("snapshot key=\(self.window.isKeyWindow) active=\(NSApp.isActive) dictationMenuItem=\(NSApp.mainMenu.map(hasDictation) ?? false)")
                    if argv.contains("--snapshot-quit") { exit(9) }
                }
            }
        }
    }

    // MARK: bridge
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let id = body["id"] as? Int, let cmd = body["cmd"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        let reply: (Bool, Any?) -> Void = { [weak self] ok, value in
            var json = "null"
            if let v = value {
                if let d = try? JSONSerialization.data(withJSONObject: [v], options: [.fragmentsAllowed]), let s = String(data: d, encoding: .utf8) { json = String(s.dropFirst().dropLast()) }
            }
            self?.web.evaluateJavaScript("window.__nativeReply(\(id), \(ok ? "true" : "false"), \(json))")
        }
        switch cmd {
        case "init": reply(true, popupInit())
        case "hit":
            let rs = (args["rects"] as? [[Double]]) ?? []
            hitRects = rs.compactMap { $0.count == 4 ? NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil }
            updateMouse(); reply(true, true)
        case "dragWindow": startWindowDrag(); reply(true, true)
        case "zoomWindow": animateZoom(); reply(true, true)
        case "pickImages": pickImages { reply(true, $0) }
        case "clipboardImages": reply(true, clipboardImages())
        case "dictateStart":
            let engine = args["engine"] as? String ?? "mac"; let lang = args["lang"] as? String ?? "en"
            if engine == "mac" { dictLang = lang; startDictation { reply(true, $0) } } else { startRecording(engine: engine, lang: lang) { reply(true, $0) } }
        case "dictateStop":
            if recEngine != nil { stopRecordingAndTranscribe() } else { stopDictation(notify: true, systemToggle: true) }
            reply(true, true)
        case "dictationInfo": reply(true, dictationInfo())
        case "saveSettings":
            _ = writeJSON(args, (dataRoot as NSString).appendingPathComponent("settings.json")); reply(true, true)
        case "openLink":
            if let s = args["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(u) }
            reply(true, true)
        case "send": reply(true, true); savePayload(args, toJob: true)
        case "cancel": reply(true, true); savePayload(args, toJob: false)
        case "saveDraft": writeDraft(args); reply(true, true)
        case "initResult": reply(true, resultInit())
        case "copyText": setRichText(args["text"] as? String ?? "", args["html"] as? String); reply(true, true)
        case "copyImages": copyFiles(args["paths"] as? [String] ?? []); reply(true, true)
        case "saveText": reply(saveText(args["text"] as? String ?? ""), true)
        case "setUseEdited": setUseEdited(args["index"] as? Int ?? -1, args["value"] as? Bool ?? true); reply(true, true)
        case "paste": paste(text: args["text"] as? String ?? "", html: args["html"] as? String, paths: args["paths"] as? [String] ?? []) { reply(true, $0) }
        case "close": reply(true, true); closeResult()

        default: reply(false, "unknown command \(cmd)")
        }
    }

    // MARK: dictation
    // Live speech-to-text with Apple's speech recognition (the engine behind Mac dictation), so the mic
    // can turn blue exactly while it listens. If that is not allowed, falls back to the system's
    // Start Dictation command.
    var audioEngine: AVAudioEngine?
    var recRequest: SFSpeechAudioBufferRecognitionRequest?
    var recTask: SFSpeechRecognitionTask?
    var systemDictation = false
    var dictLang = "en"
    // ----- recording engines (Parakeet = Handy's engine, Whisper): record, then write the text -----
    var recEngine: String? = nil
    var recLang = "en"
    var recSamples: [Float] = []
    var recAudio: AVAudioEngine?
    var recCount = 0
    var skillDir: String { uiDir.deletingLastPathComponent().path }
    var parakeetBin: String { (skillDir as NSString).appendingPathComponent("engine/transcribe-cli") }
    var parakeetModel: String? {
        let a = home.appendingPathComponent(".claude/prompt-enhancer-engine/models/parakeet-tdt-0.6b-v3-Q8_0.gguf").path
        let b = home.appendingPathComponent("Library/Application Support/com.pais.handy/models/parakeet-tdt-0.6b-v3-Q8_0.gguf").path
        return fm.fileExists(atPath: a) ? a : (fm.fileExists(atPath: b) ? b : nil)
    }
    var whisperBin: String? { ["/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cli"].first { fm.isExecutableFile(atPath: $0) } }
    var whisperModel: String? { let p = home.appendingPathComponent(".cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin").path; return fm.fileExists(atPath: p) ? p : nil }
    func dictationInfo() -> [String: Any] {
        return ["parakeet": fm.isExecutableFile(atPath: parakeetBin) && parakeetModel != nil,
                "whisper": whisperBin != nil && whisperModel != nil, "mac": true,
                "languages": (UserDefaults.standard.array(forKey: "AppleLanguages") as? [String]) ?? ["en"]]
    }
    func startRecording(engine: String, lang: String, _ done: @escaping ([String: Any]) -> Void) {
        if recEngine != nil { done(["ok": true, "mode": "record"]); return }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                self.refocus()
                guard granted else { done(["ok": false, "message": "Microphone access is off. Turn it on in System Settings › Privacy & Security › Microphone (Enhance Prompt)."]); return }
                let eng = AVAudioEngine(); let input = eng.inputNode; let inFmt = input.outputFormat(forBus: 0)
                guard inFmt.sampleRate > 0, inFmt.channelCount > 0,
                      let outFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false),
                      let conv = AVAudioConverter(from: inFmt, to: outFmt) else { done(["ok": false, "message": "No microphone input found."]); return }
                self.recSamples = []
                input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { buf, _ in
                    let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / inFmt.sampleRate) + 32
                    guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: cap) else { return }
                    var fed = false; var err: NSError?
                    conv.convert(to: out, error: &err) { _, status in
                        if fed { status.pointee = .noDataNow; return nil }
                        fed = true; status.pointee = .haveData; return buf
                    }
                    if let ch = out.floatChannelData, out.frameLength > 0 {
                        let arr = Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
                        DispatchQueue.main.async { self.recSamples.append(contentsOf: arr) }
                    }
                }
                eng.prepare()
                do { try eng.start() } catch { input.removeTap(onBus: 0); done(["ok": false, "message": "The microphone could not start (\(error.localizedDescription))."]); return }
                self.recAudio = eng; self.recEngine = engine; self.recLang = lang
                done(["ok": true, "mode": "record"])
            }
        }
    }
    func endRecording() -> [Float] {
        if let e = recAudio { e.inputNode.removeTap(onBus: 0); e.stop() }
        recAudio = nil
        let s = recSamples; recSamples = []
        return s
    }
    func writeWav(_ samples: [Float], to path: String) -> Bool {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        let n = samples.count
        d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + n * 2)); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16); d.append("data".data(using: .ascii)!); u32(UInt32(n * 2))
        var pcm = [Int16](repeating: 0, count: n)
        for i in 0..<n { pcm[i] = Int16(max(-1, min(1, samples[i])) * 32767) }
        pcm.withUnsafeBytes { d.append(contentsOf: $0) }
        return (try? d.write(to: URL(fileURLWithPath: path))) != nil
    }
    func stopRecordingAndTranscribe() {
        guard let engine = recEngine else { return }
        recEngine = nil
        let samples = endRecording()
        if samples.count < 16000 / 4 { sendDictation(["done": true, "error": "Nothing was recorded. Try again and speak a little longer."]); return }
        sendDictation(["state": "transcribing"])
        recCount += 1
        let dir = jobDir.isEmpty ? NSTemporaryDirectory() : jobDir
        let wav = (dir as NSString).appendingPathComponent("dictation-\(recCount).wav")
        guard writeWav(samples, to: wav) else { sendDictation(["done": true, "error": "Could not save the recording."]); return }
        let lang = recLang; let seconds = Double(samples.count) / 16000
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process(); let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
            var outFile: String? = nil
            if engine == "parakeet", let m = self.parakeetModel {
                outFile = wav + ".txt"
                p.executableURL = URL(fileURLWithPath: self.parakeetBin)
                p.arguments = ["-q", "-m", m, "-l", lang, "-o", outFile!, wav]
            } else if let b = self.whisperBin, let m = self.whisperModel {
                // A shorter audio window for short clips makes Whisper much faster here, with the same text.
                let ctx = min(1500, max(256, Int(ceil(seconds / 30 * 1500)) + 64))
                p.executableURL = URL(fileURLWithPath: b)
                p.arguments = ["-m", m, "-l", lang, "-t", "8", "-ac", "\(ctx)", "-nt", "-np", "-f", wav]
            } else {
                DispatchQueue.main.async { self.sendDictation(["done": true, "error": "The dictation engine is not installed."]) }; return
            }
            var text = ""; var failed = false
            do {
                try p.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                p.waitUntilExit()
                if let f = outFile { text = (try? String(contentsOfFile: f, encoding: .utf8)) ?? "" ; try? fm.removeItem(atPath: f) }
                else { text = String(data: data, encoding: .utf8) ?? "" }
                failed = p.terminationStatus != 0 && text.isEmpty
            } catch { failed = true }
            try? fm.removeItem(atPath: wav)
            text = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                if failed { self.sendDictation(["done": true, "error": "Dictation failed."]) }
                else { self.sendDictation(["text": text, "final": true, "done": true]) }
            }
        }
    }
    func sendDictation(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__dictation && window.__dictation(\(s))")
    }
    func refocus() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
    func startDictation(_ done: @escaping ([String: Any]) -> Void) {
        if audioEngine != nil { done(["ok": true, "mode": "speech"]); return }
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                self.refocus()
                guard status == .authorized else { done(self.systemDictationToggle(reason: "speech recognition not allowed (\(status.rawValue))")); return }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        self.refocus()
                        guard granted else { done(["ok": false, "message": "Microphone access is off. Turn it on in System Settings › Privacy & Security › Microphone."]); return }
                        do { try self.beginRecognition(); done(["ok": true, "mode": "speech"]) }
                        catch { done(self.systemDictationToggle(reason: "\(error.localizedDescription)")) }
                    }
                }
            }
        }
    }
    func beginRecognition() throws {
        let langs = [dictLang] + ((UserDefaults.standard.array(forKey: "AppleLanguages") as? [String]) ?? [])
        var recognizer: SFSpeechRecognizer? = nil
        for l in langs { if let r = SFSpeechRecognizer(locale: Locale(identifier: l)), r.isAvailable { recognizer = r; break } }
        if recognizer == nil { recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() }
        guard let rec = recognizer, rec.isAvailable else { throw NSError(domain: "pe", code: 1, userInfo: [NSLocalizedDescriptionKey: "speech recognition is not available"]) }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else { throw NSError(domain: "pe", code: 2, userInfo: [NSLocalizedDescriptionKey: "no microphone input found"]) }
        input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in req.append(buf) }
        engine.prepare()
        try engine.start()
        audioEngine = engine; recRequest = req
        recTask = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let r = result { self.sendDictation(["text": r.bestTranscription.formattedString, "final": r.isFinal]) }
                if error != nil || (result?.isFinal ?? false) { self.stopDictation(notify: true, systemToggle: false) }
            }
        }
    }
    func stopDictation(notify: Bool, systemToggle: Bool) {
        if recEngine != nil { recEngine = nil; _ = endRecording() }
        if let e = audioEngine { e.inputNode.removeTap(onBus: 0); e.stop() }
        recRequest?.endAudio(); recTask?.finish()
        audioEngine = nil; recRequest = nil; recTask = nil
        if systemDictation && systemToggle { _ = triggerSystemDictation() }
        systemDictation = false
        if notify { sendDictation(["done": true]) }
    }
    func triggerSystemDictation() -> Bool {
        // Use the Start/Stop Dictation item AppKit adds to the Edit menu, like choosing it by hand.
        func find(_ m: NSMenu) -> (NSMenu, Int)? {
            for (i, it) in m.items.enumerated() {
                if let a = it.action, NSStringFromSelector(a) == "startDictation:" { return (m, i) }
                if let sub = it.submenu, let r = find(sub) { return r }
            }
            return nil
        }
        if let main = NSApp.mainMenu, let (m, i) = find(main) { m.performActionForItem(at: i); return true }
        return NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil)
    }
    func systemDictationToggle(reason: String) -> [String: Any] {
        log("speech recognition unavailable: \(reason); trying system dictation")
        let ok = triggerSystemDictation()
        systemDictation = ok
        return ok ? ["ok": true, "mode": "system"] : ["ok": false, "message": "Dictation could not start (\(reason))."]
    }

    // MARK: popup
    func popupInit() -> [String: Any] {
        var st = (arg("--state").flatMap { readJSON($0) }) ?? [:]
        if var d = st["draft"] as? [String: Any], let imgs = d["images"] as? [[String: Any]] {
            d["images"] = imgs.compactMap { im -> [String: Any]? in
                guard let p = im["file"] as? String, fm.fileExists(atPath: p) else { return nil }
                var o = im; o["src"] = fileURLString(p); o["path"] = p; return o
            }
            st["draft"] = d
        }
        return st
    }
    func pickImages(_ done: @escaping ([[String: Any]]) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image]
        panel.level = .modalPanel
        window.level = .normal
        let r = panel.runModal()
        window.level = .floating
        NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil)
        guard r == .OK else { done([]); return }
        done(panel.urls.map { ["src": fileURLString($0.path), "path": $0.path] })
    }
    func clipboardImages() -> [[String: Any]] {
        let pb = NSPasteboard.general
        var out: [[String: Any]] = []
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] {
            for u in urls where imageExts.contains(u.pathExtension.lowercased()) { out.append(["src": fileURLString(u.path), "path": u.path]) }
        }
        if out.isEmpty, let img = NSImage(pasteboard: pb), let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
            pasteCount += 1
            let dir = jobDir.isEmpty ? NSTemporaryDirectory() : jobDir
            let p = (dir as NSString).appendingPathComponent("pasted-\(pasteCount).png")
            if (try? png.write(to: URL(fileURLWithPath: p))) != nil { out.append(["src": fileURLString(p), "path": p]) }
        }
        return out
    }
    // Saves the draft without quitting (used before dictation starts).
    func writeDraft(_ p: [String: Any]) {
        guard !draftDir.isEmpty, !finished else { return }
        writeFiles(p, dir: draftDir, name: "draft.json", clear: true)
    }
    // Writes the images and a small JSON file, then quits. Send → job folder (exit 0); cancel → draft folder (exit 3).
    func savePayload(_ p: [String: Any], toJob: Bool) {
        if finished { return }
        stopDictation(notify: false, systemToggle: true)
        finished = true
        let dir = toJob ? jobDir : draftDir
        guard !dir.isEmpty else { exit(toJob ? 4 : 3) }
        writeFiles(p, dir: dir, name: toJob ? "job.json" : "draft.json", clear: !toJob)
        window.orderOut(nil)
        finish(toJob ? "sent" : "cancelled", toJob ? 0 : 3)
    }
    // Tells the waiting helper how the popup ended (it is no longer our parent process), then quits.
    func finish(_ status: String, _ code: Int32) {
        if !jobDir.isEmpty { try? status.write(toFile: (jobDir as NSString).appendingPathComponent("status"), atomically: true, encoding: .utf8) }
        exit(code)
    }
    func writeFiles(_ p: [String: Any], dir: String, name: String, clear: Bool) {
        if clear { try? fm.removeItem(atPath: dir) }
        try? fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var images: [[String: Any]] = []
        for (i, im) in ((p["images"] as? [[String: Any]]) ?? []).enumerated() {
            var rec: [String: Any] = ["shapes": im["shapes"] ?? [], "crop": im["crop"] ?? NSNull(), "nw": im["nw"] ?? 0, "nh": im["nh"] ?? 0]
            var origPath: String? = nil
            if let src = im["path"] as? String, fm.fileExists(atPath: src) {
                let ext = (src as NSString).pathExtension.lowercased()
                let dst = (dir as NSString).appendingPathComponent("img-\(i + 1).\(ext.isEmpty ? "png" : ext)")
                if src != dst { try? fm.removeItem(atPath: dst); try? fm.copyItem(atPath: src, toPath: dst) }
                origPath = dst
            } else if let data = (im["data"] as? String).flatMap(dataFromDataURL) {
                let dst = (dir as NSString).appendingPathComponent("img-\(i + 1).png")
                try? data.write(to: URL(fileURLWithPath: dst)); origPath = dst
            }
            guard let op = origPath else { continue }
            rec["file"] = op
            if let e = (im["edited"] as? String).flatMap(dataFromDataURL) {
                let dst = (dir as NSString).appendingPathComponent("img-\(i + 1).edited.png")
                try? e.write(to: URL(fileURLWithPath: dst)); rec["edited"] = dst
            }
            images.append(rec)
        }
        let out: [String: Any] = ["text": p["text"] ?? "", "wc": p["wc"] ?? false, "revise": p["revise"] ?? NSNull(), "images": images]
        _ = writeJSON(out, (dir as NSString).appendingPathComponent(name))
    }

    // MARK: result
    var recordPath: String { arg("--record") ?? "" }
    var version: Int { Int(arg("--version") ?? "") ?? 0 }
    func loadVersion() -> (rec: [String: Any], idx: Int)? {
        guard let rec = readJSON(recordPath), let vs = rec["versions"] as? [[String: Any]], !vs.isEmpty else { return nil }
        let idx = vs.firstIndex { ($0["v"] as? Int) == version } ?? (vs.count - 1)
        return (rec, idx)
    }
    func resultInit() -> [String: Any] {
        guard let (rec, idx) = loadVersion(), let vs = rec["versions"] as? [[String: Any]] else { return ["error": "Could not read the saved result."] }
        let v = vs[idx]
        let base = (recordPath as NSString).deletingLastPathComponent
        func abs(_ p: Any?) -> String? { guard let s = p as? String, !s.isEmpty else { return nil }; return s.hasPrefix("/") ? s : (base as NSString).appendingPathComponent(s) }
        let imgs: [[String: Any]] = ((v["images"] as? [[String: Any]]) ?? []).compactMap { im in
            guard let o = abs(im["orig"]), fm.fileExists(atPath: o) else { return nil }
            var r: [String: Any] = ["orig": fileURLString(o), "origPath": o, "useEdited": im["use_edited"] as? Bool ?? true]
            if let e = abs(im["edited"]), fm.fileExists(atPath: e) { r["edited"] = fileURLString(e); r["editedPath"] = e }
            return r
        }
        var out: [String: Any] = ["n": rec["n"] ?? 0, "v": v["v"] ?? 1, "model": v["model"] ?? "", "effort": v["effort"] ?? "",
                                  "time": v["time_label"] ?? "", "text": v["text"] ?? "", "original": v["draft"] ?? "",
                                  "changes": v["changes"] ?? [], "gaps": v["gaps"] ?? [], "notes": v["notes"] ?? [], "images": imgs]
        if let e = v["error"] as? String, !e.isEmpty { out["error"] = e }
        if let n = v["notice"] as? String, !n.isEmpty { out["notice"] = n }
        return out
    }
    func saveText(_ text: String) -> Bool {
        guard var (rec, idx) = loadVersion(), var vs = rec["versions"] as? [[String: Any]] else { return false }
        var v = vs[idx]
        if v["error"] != nil, (v["error"] as? String)?.isEmpty == false { return true }
        v["text"] = text
        v["edited_by_user"] = (text != (v["model_text"] as? String ?? text))
        vs[idx] = v; rec["versions"] = vs
        return writeJSON(rec, recordPath)
    }
    func setUseEdited(_ i: Int, _ value: Bool) {
        guard var (rec, idx) = loadVersion(), var vs = rec["versions"] as? [[String: Any]] else { return }
        var v = vs[idx]
        var imgs = (v["images"] as? [[String: Any]]) ?? []
        guard i >= 0, i < imgs.count else { return }
        imgs[i]["use_edited"] = value; v["images"] = imgs; vs[idx] = v; rec["versions"] = vs
        _ = writeJSON(rec, recordPath)
    }
    func copyFiles(_ paths: [String]) {
        let pb = NSPasteboard.general; pb.clearContents()
        // Each file is its own clipboard item with an explicit file URL (the form the Claude app accepts).
        let items: [NSPasteboardItem] = paths.filter { fm.fileExists(atPath: $0) }.map { p in
            let it = NSPasteboardItem(); it.setString(URL(fileURLWithPath: p).absoluteString, forType: .fileURL); return it
        }
        if !items.isEmpty { pb.writeObjects(items) }
    }
    // Formatted copy: rich text (HTML) for apps that keep formatting, Markdown as the plain-text fallback.
    func setRichText(_ text: String, _ html: String?) {
        let pb = NSPasteboard.general; pb.clearContents()
        let item = NSPasteboardItem()
        if let h = html, !h.isEmpty { item.setString("<meta charset=\"utf-8\">" + h, forType: .html) }
        item.setString(text, forType: .string)
        pb.writeObjects([item])
    }
    func pressCmdV() {
        let src = CGEventSource(stateID: .combinedSessionState)
        let down = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: true); down?.flags = .maskCommand
        let up = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: false); up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap); up?.post(tap: .cghidEventTap)
    }
    // Auto-paste: needs the Accessibility permission. Pastes the images first, then the text
    // (one paste cannot carry both into the Claude app).
    func paste(text: String, html: String?, paths: [String], done: @escaping ([String: Any]) -> Void) {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(opts) else { done(["needsPermission": true]); return }
        guard let claude = NSRunningApplication.runningApplications(withBundleIdentifier: "com.anthropic.claudefordesktop").first else { done(["noClaude": true]); return }
        claude.activate()
        let files = paths.filter { fm.fileExists(atPath: $0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            var wait = 0.0
            if !files.isEmpty { self.copyFiles(files); self.pressCmdV(); wait = 0.7 }
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                self.setRichText(text, html)
                self.pressCmdV()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { done(["ok": true]) }
            }
        }
    }
    func closeResult() { closingAllowed = true; window.close(); NSApp.terminate(nil) }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if mode != "result" || closingAllowed { return true }
        // Save the last edit before closing.
        web.evaluateJavaScript("window.__flush ? window.__flush() : true") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.closingAllowed = true; NSApp.terminate(nil) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.terminate(nil) }
        return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
