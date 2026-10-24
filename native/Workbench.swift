import AppKit
import Foundation
import Darwin
import UniformTypeIdentifiers

struct WorkbenchError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

struct Workspace: Codable {
    var formatVersion = 1
    var id = UUID().uuidString
    var latestBackup: String?
}

struct LocalState: Codable { var baseBackup: String? }
let fm = FileManager.default
let triliumVersion = "0.106.1"

func writeJSON<T: Encodable>(_ value: T, _ file: URL) throws {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(value).write(to: file, options: .atomic)
}

func runSQLite(_ database: URL, _ statement: String, directory: URL? = nil, immutable: Bool = false) throws -> String {
    let process = Process(), output = Pipe(), errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    let file = immutable ? database.absoluteString + "?mode=ro&immutable=1" : database.path
    process.arguments = ["-batch", "-cmd", ".timeout 5000", file, statement]
    process.currentDirectoryURL = directory
    process.standardOutput = output; process.standardError = errors
    try process.run(); process.waitUntilExit()
    let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    if process.terminationStatus != 0 {
        throw WorkbenchError("数据库操作未完成：" + String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self))
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

func validateBackup(_ file: URL) throws {
    guard file.lastPathComponent != "document.db", fm.fileExists(atPath: file.path) else {
        throw WorkbenchError("请选择已经完成的 .db 备份，不要选择运行中的 document.db。")
    }
    let result = try runSQLite(file, "PRAGMA quick_check; SELECT value FROM attributes WHERE noteId='root' AND name='workbenchFormat' AND isDeleted=0;", immutable: true)
    guard result == "ok\n1" else { throw WorkbenchError("这不是完整的 v1 工作台备份；原文件没有修改。") }
}

func loadWorkspace(_ folder: URL) throws -> Workspace {
    let value = try JSONDecoder().decode(Workspace.self, from: Data(contentsOf: folder.appendingPathComponent("workspace.json")))
    guard value.formatVersion == 1, UUID(uuidString: value.id) != nil else { throw WorkbenchError("工作区版本或编号无效。") }
    if let name = value.latestBackup {
        guard name.hasPrefix("backups/"), name.split(separator: "/").count == 2 else { throw WorkbenchError("备份路径无效。") }
        let file = folder.appendingPathComponent(name).resolvingSymlinksInPath()
        guard file.deletingLastPathComponent() == folder.appendingPathComponent("backups").resolvingSymlinksInPath() else { throw WorkbenchError("备份不在本工作区内。") }
    }
    return value
}

func createWorkspace(_ folder: URL, backup: URL?) throws -> Workspace {
    if let backup { try validateBackup(backup) }
    if fm.fileExists(atPath: folder.path) {
        guard try fm.contentsOfDirectory(atPath: folder.path).filter({ $0 != ".DS_Store" }).isEmpty else {
            throw WorkbenchError("新建或恢复请选择一个空文件夹；已有资料不会被覆盖。")
        }
    } else { try fm.createDirectory(at: folder, withIntermediateDirectories: true) }
    try fm.createDirectory(at: folder.appendingPathComponent("backups"), withIntermediateDirectories: true)
    var workspace = Workspace()
    if let backup {
        let name = "backups/restored-\(UUID().uuidString).db"
        try fm.copyItem(at: backup, to: folder.appendingPathComponent(name))
        workspace.latestBackup = name
    }
    try writeJSON(workspace, folder.appendingPathComponent("workspace.json"))
    return workspace
}

func prepareRuntime(_ folder: URL, workspace: Workspace, base: URL) throws -> URL {
    let runtime = base.appendingPathComponent(workspace.id, isDirectory: true)
    for name in ["data", "electron", "backups", "log", "tmp"] {
        try fm.createDirectory(at: runtime.appendingPathComponent(name), withIntermediateDirectories: true)
    }
    let database = runtime.appendingPathComponent("data/document.db")
    let stateFile = runtime.appendingPathComponent("local-state.json")
    if fm.fileExists(atPath: database.path) {
        if let latest = workspace.latestBackup {
            let local = try JSONDecoder().decode(LocalState.self, from: Data(contentsOf: stateFile))
            guard local.baseBackup == latest else {
                throw WorkbenchError("共享位置已有另一份备份。本机进度已保留；请用“从备份恢复”选一个新空目录接续，避免覆盖未核对的本机修改。")
            }
        }
    } else if let latest = workspace.latestBackup {
        let backup = folder.appendingPathComponent(latest)
        try validateBackup(backup)
        try fm.copyItem(at: backup, to: database)
    }
    let config = runtime.appendingPathComponent("data/config.ini")
    if !fm.fileExists(atPath: config.path) {
        try "[General]\ninstanceName=Trilium Workbench\n[Security]\nbackendScriptingEnabled=true\n".write(to: config, atomically: true, encoding: .utf8)
    }
    try writeJSON(LocalState(baseBackup: workspace.latestBackup), stateFile)
    return runtime
}

func publishWorkspace(_ folder: URL, workspace: Workspace, runtime: URL) throws -> Workspace {
    let temporary = runtime.appendingPathComponent("export.partial.db")
    if fm.fileExists(atPath: temporary.path) { try fm.removeItem(at: temporary) }
    defer { try? fm.removeItem(at: temporary) }
    // SQLite's native backup includes committed WAL pages; never copy a live document.db.
    _ = try runSQLite(runtime.appendingPathComponent("data/document.db"), ".backup export.partial.db", directory: runtime)
    try validateBackup(temporary)
    let name = "backups/workspace-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString).db"
    let final = folder.appendingPathComponent(name), partial = folder.appendingPathComponent(name + ".part")
    do {
        try fm.copyItem(at: temporary, to: partial)
        try fm.moveItem(at: partial, to: final)
    } catch { try? fm.removeItem(at: partial); throw error }
    var updated = workspace; updated.latestBackup = name
    try writeJSON(updated, folder.appendingPathComponent("workspace.json"))
    try writeJSON(LocalState(baseBackup: name), runtime.appendingPathComponent("local-state.json"))
    return updated
}

func freePort() throws -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { throw WorkbenchError("无法分配本机服务端口。") }
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bound = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    guard bound == 0 else { throw WorkbenchError("无法分配本机端口。") }
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
    }
    return Int(UInt16(bigEndian: address.sin_port))
}

func launchTrilium(_ app: URL, runtime: URL, debugging: Bool) throws -> Process {
    guard Bundle(url: app)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == triliumVersion else {
        throw WorkbenchError("本轮适配 Trilium \(triliumVersion)，请选择同版应用；不会替换原应用。")
    }
    let process = Process(), port = try freePort()
    process.executableURL = app.appendingPathComponent("Contents/MacOS/trilium")
    var env = ProcessInfo.processInfo.environment
    for (key, dir) in [("TRILIUM_DATA_DIR","data"),("TRILIUM_ELECTRON_DATA_DIR","electron"),("TRILIUM_BACKUP_DIR","backups"),("TRILIUM_LOG_DIR","log"),("TRILIUM_TMP_DIR","tmp")] {
        env[key] = runtime.appendingPathComponent(dir).path
    }
    env["TRILIUM_PORT"] = String(port); process.environment = env
    process.arguments = ["--user-data-dir=" + runtime.appendingPathComponent("electron").path]
    if debugging {
        let marker = runtime.appendingPathComponent("electron/DevToolsActivePort")
        if fm.fileExists(atPath: marker.path) { try fm.removeItem(at: marker) }
        process.arguments! += ["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"]
    }
    let log = runtime.appendingPathComponent("launcher.log")
    fm.createFile(atPath: log.path, contents: nil)
    let handle = try FileHandle(forWritingTo: log)
    process.standardOutput = handle; process.standardError = handle
    try process.run()
    try? handle.close()
    return process
}

func debuggerPort(_ runtime: URL, process: Process) async throws -> Int {
    let marker = runtime.appendingPathComponent("electron/DevToolsActivePort")
    for _ in 0..<300 {
        if let text = try? String(contentsOf: marker, encoding: .utf8), let line = text.split(separator: "\n").first, let port = Int(line) { return port }
        if !process.isRunning { throw WorkbenchError("Trilium 启动失败，请查看本机运行记录。") }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw WorkbenchError("初始化窗口未就绪；本机工作数据已保留。")
}

func pageTarget(_ port: Int) async throws -> URL {
    var request=URLRequest(url:URL(string:"http://127.0.0.1:\(port)/json/list")!); request.timeoutInterval=5
    let (data, _) = try await URLSession.shared.data(for:request)
    let pages = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] ?? []
    guard let page = pages.first(where: { ($0["url"] as? String ?? "").hasPrefix("trilium-app://app/") }),
          let address = page["webSocketDebuggerUrl"] as? String, let url = URL(string: address) else { throw WorkbenchError("初始化页面正在切换。") }
    return url
}

func evaluate(_ port: Int, expression: String) async throws -> Any {
    let socket = URLSession.shared.webSocketTask(with: try await pageTarget(port))
    socket.resume(); defer { socket.cancel(with: .normalClosure, reason: nil) }
    let request: [String: Any] = ["id":1, "method":"Runtime.evaluate", "params":["expression":expression,"awaitPromise":true,"returnByValue":true]]
    try await socket.send(.string(String(decoding:JSONSerialization.data(withJSONObject:request),as:UTF8.self)))
    while true {
        let data: Data
        switch try await socket.receive() {
        case .data(let bytes): data = bytes
        case .string(let text): data = Data(text.utf8)
        @unknown default: throw WorkbenchError("初始化消息格式错误。")
        }
        guard let message = try JSONSerialization.jsonObject(with: data) as? [String: Any], message["id"] as? Int == 1 else { continue }
        guard let result = message["result"] as? [String: Any], result["exceptionDetails"] == nil,
              let remote = result["result"] as? [String: Any] else { throw WorkbenchError("工作区初始化脚本未完成：" + String(describing: message["result"] ?? message["error"] ?? "无返回值")) }
        if let exception = remote["description"] as? String, remote["subtype"] as? String == "error" { throw WorkbenchError(exception) }
        return remote["value"] ?? NSNull()
    }
}

func jsLiteral(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), as: UTF8.self)
}

func initializeWorkspaceDatabase(_ port: Int, resources: URL) async throws {
    var initialized = false
    for _ in 0..<300 {
        if let result = try? await evaluate(port, expression: "typeof glob !== 'undefined' && glob.dbInitialized === true && typeof glob.getHeaders === 'function'"), result as? Bool == true { initialized = true; break }
        if let ready = try? await evaluate(port, expression: "typeof glob !== 'undefined'"), ready as? Bool == true { break }
        try await Task.sleep(nanoseconds: 100_000_000)
    }
    if !initialized {
        // Official setup replaces its own window. A lost context is expected only if the new window confirms initialization.
        _ = try? await evaluate(port, expression: "(async()=>{const r=await fetch('api/setup/new-document?skipDemoDb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locale:'cn'})});if(!r.ok)throw new Error('官方初始化失败');location.reload();return true})()")
        for _ in 0..<300 {
            if let result = try? await evaluate(port, expression: "typeof glob !== 'undefined' && glob.dbInitialized === true && typeof glob.getHeaders === 'function'"), result as? Bool == true { initialized = true; break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }
    guard initialized else { throw WorkbenchError("官方空白知识库初始化未完成。") }
    let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("bundle.json")))
    let script = try String(contentsOf: resources.appendingPathComponent("bootstrap.js"), encoding: .utf8)
    let payload = try jsLiteral(["script":script,"params":[bundle],"startNoteId":"twBootstrap","currentNoteId":"twBootstrap","originEntityName":"notes","originEntityId":"root","transactional":true] as [String:Any])
    let expression = """
    (async()=>{
      const headers={...glob.getHeaders(),'Content-Type':'application/json'};
      const initial=await fetch('api/notes/twBootstrap',{headers});
      if(initial.status===404){const r=await fetch('api/notes/root/children?target=into',{method:'POST',headers,body:JSON.stringify({noteId:'twBootstrap',title:'工作区装配',type:'code',mime:'application/javascript',content:'',attributes:[{type:'label',name:'scriptEnv',value:'backend',isInheritable:false}]})});if(!r.ok)throw new Error('无法装配工作区');}
      const r=await fetch('api/script/exec',{method:'POST',headers,body:JSON.stringify(\(payload))});const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'装配失败');
      const prefs=await fetch('api/options',{method:'PUT',headers,body:JSON.stringify({theme:'next-light',backgroundEffects:'false',detailFontSize:'100',rightPaneVisible:'false',leftPaneWidth:'22'})});if(!prefs.ok)throw new Error('外观初始化失败');return true;
    })()
    """
    _ = try await evaluate(port, expression: expression)
    _ = try? await evaluate(port, expression: "location.reload(); true")
}

@MainActor
final class Launcher: NSObject, NSApplicationDelegate {
    var child: Process?
    var runtimeLock: Int32 = -1
    var progress: NSWindow?
    let args = CommandLine.arguments
    var testing: Bool { args.contains("--testing") }
    var cli: Bool { args.contains("--new") || args.contains("--open") }
    func option(_ name: String) -> String? { guard let index=args.firstIndex(of:name), index+1<args.count else { return nil }; return args[index+1] }
    func file(_ path: String) -> URL { URL(fileURLWithPath:path).standardizedFileURL.resolvingSymlinksInPath() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { do { try await start() } catch { fail(error) } }
    }

    func start() async throws {
        let folder: URL, workspace: Workspace
        if let path = option("--new") { folder=file(path); workspace=try createWorkspace(folder,backup:option("--restore").map(file)) }
        else if let path = option("--open") { folder=file(path); workspace=try loadWorkspace(folder) }
        else {
            guard let choice=try chooseWorkspace() else { NSApp.terminate(nil); return }
            folder=choice.0; workspace=choice.1
        }
        let base = option("--runtime-root").map(file) ?? fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("TriliumWorkbench/workspaces")
        let runtime=try prepareRuntime(folder,workspace:workspace,base:base)
        let lock=Darwin.open(runtime.appendingPathComponent("launcher.lock").path,O_CREAT|O_RDWR|O_CLOEXEC,0o600)
        guard lock >= 0 else { throw WorkbenchError("无法锁定本机工作区。") }
        guard flock(lock,LOCK_EX|LOCK_NB) == 0 else { close(lock); throw WorkbenchError("这个工作区已在运行，请回到已有窗口继续。") }
        runtimeLock=lock
        let app=try triliumApp()
        if !cli { showProgress() }
        let isNew = workspace.latestBackup == nil && !fm.fileExists(atPath:runtime.appendingPathComponent("workbench-ready").path)
        child=try launchTrilium(app,runtime:runtime,debugging:isNew || testing)
        UserDefaults.standard.set(app.path, forKey: "triliumAppPath")
        if isNew {
            let port=try await debuggerPort(runtime,process:child!)
            try await initializeWorkspaceDatabase(port,resources:Bundle.main.resourceURL!)
            try Data().write(to:runtime.appendingPathComponent("workbench-ready"),options:.atomic)
            if !testing {
                child!.terminate(); child!.waitUntilExit()
                child=try launchTrilium(app,runtime:runtime,debugging:false)
            }
        }
        progress?.close()
        if testing {
            let port=try await debuggerPort(runtime,process:child!)
            let info: [String: String] = ["pid":String(child!.processIdentifier),"debugPort":String(port),"runtime":runtime.path,"workspace":folder.path]
            try writeJSON(info,runtime.appendingPathComponent("testing.json"))
            print("READY " + runtime.path)
            fflush(stdout)
        }
        let process=child!
        process.terminationHandler = { [weak self] ended in
            DispatchQueue.main.async { self?.finished(ended,folder:folder,workspace:workspace,runtime:runtime) }
        }
        if !process.isRunning { finished(process,folder:folder,workspace:workspace,runtime:runtime) }
    }

    func finished(_ process: Process, folder: URL, workspace: Workspace, runtime: URL) {
        guard child === process else { return }; child=nil
        do {
            let log=(try? String(contentsOf:runtime.appendingPathComponent("launcher.log"),encoding:.utf8)) ?? ""
            if log.contains("already an instance running") { NSApp.terminate(nil); return }
            guard process.terminationStatus == 0 || process.terminationStatus == SIGTERM else { throw WorkbenchError("工作台异常退出，本机数据已保留，未覆盖可移植备份。") }
            _ = try publishWorkspace(folder,workspace:workspace,runtime:runtime)
            if cli { print("SAVED " + folder.path); fflush(stdout) }
            else {
                let alert=NSAlert(); alert.messageText="工作区已保存"
                alert.informativeText="完整备份已保存到：\n" + folder.path + "\n\n可以从这里的完成备份恢复；若使用同步文件夹，请等待该服务完成上传后再换机。"
                alert.addButton(withTitle:"完成"); alert.runModal()
            }
            NSApp.terminate(nil)
        } catch { fail(error) }
    }

    func fail(_ error: Error) {
        if let child, child.isRunning { child.terminate(); child.waitUntilExit() }; child=nil
        progress?.close()
        if cli { fputs("ERROR: \(error.localizedDescription)\n",stderr); exit(1) }
        let alert=NSAlert(); alert.messageText="工作区未完成"; alert.informativeText=error.localizedDescription + "\n已有本机资料和原备份均保留。"; alert.runModal()
        NSApp.terminate(nil)
    }

    func chooseWorkspace() throws -> (URL, Workspace)? {
        let alert=NSAlert(); alert.messageText="打开你的工作台"
        alert.informativeText="所选位置保存完成的备份与可移植资料；实际编辑数据留在本机。换机前请退出 Trilium（⌘Q），启动器会保存完整备份。"
        for title in ["新建工作区","打开已有工作区","从备份恢复","取消"] { alert.addButton(withTitle:title) }
        let action=alert.runModal()
        if action == NSApplication.ModalResponse(rawValue:1003) { return nil }
        var backup: URL?
        if action == NSApplication.ModalResponse(rawValue:1002) {
            let picker=NSOpenPanel(); picker.title="选择已完成的工作台 .db 备份"; picker.allowedContentTypes=[UTType(filenameExtension:"db") ?? .database]; picker.canChooseDirectories=false
            guard picker.runModal() == .OK, let url=picker.url else { return nil }; backup=url
        }
        let picker=NSOpenPanel(); picker.canChooseFiles=false; picker.canChooseDirectories=true; picker.canCreateDirectories=true
        picker.title = action == .alertSecondButtonReturn ? "选择已有工作区文件夹" : "选择一个新的空文件夹"
        guard picker.runModal() == .OK, let folder=picker.url else { return nil }
        return action == .alertSecondButtonReturn ? (folder,try loadWorkspace(folder)) : (folder,try createWorkspace(folder,backup:backup))
    }

    func triliumApp() throws -> URL {
        if let path=option("--trilium") { return file(path) }
        let saved=UserDefaults.standard.string(forKey:"triliumAppPath").map(file)
        let candidates=[saved,fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Trilium Notes.app"),URL(fileURLWithPath:"/Applications/Trilium Notes.app")].compactMap{$0}
        if let app=candidates.first(where:{Bundle(url:$0)?.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String == triliumVersion}) { return app }
        let picker=NSOpenPanel(); picker.title="选择本机的 Trilium \(triliumVersion)"; picker.allowedContentTypes=[.applicationBundle]; picker.canChooseDirectories=false
        guard picker.runModal() == .OK, let app=picker.url else { throw WorkbenchError("本轮入口需要本机已有 Trilium \(triliumVersion)，尚未包含独立运行内核。") }
        return app
    }

    func showProgress() {
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:420,height:130),styleMask:[.titled],backing:.buffered,defer:false)
        window.title="Trilium 工作台"
        let label=NSTextField(wrappingLabelWithString:"正在准备工作区…\n首次打开会调用 Trilium 原生初始化，请稍候。")
        label.frame=NSRect(x:25,y:30,width:370,height:65); window.contentView?.addSubview(label)
        window.center(); window.makeKeyAndOrderFront(nil); progress=window
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct WorkbenchMain {
    @MainActor static func main() {
        let app=NSApplication.shared
        let launcher=Launcher(); app.delegate=launcher
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
