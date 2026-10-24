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
    var external: ExternalReference?
    var businessBackup: BusinessBackup?
}

struct BusinessBackup: Codable { let directory: String; let files: [String] }

struct LocalState: Codable { var baseBackup: String? }
let fm = FileManager.default
let triliumVersion = "0.106.1"

func terminateOwnedProcess(_ process: Process) {
    // Signal the owned PID only; Electron's helpers may share its process group.
    if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGTERM) }
}

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
    guard ["ok\n1","ok\n2"].contains(result) else { throw WorkbenchError("这不是完整的工作台备份；原文件没有修改。") }
}

func loadWorkspace(_ folder: URL) throws -> Workspace {
    let value = try JSONDecoder().decode(Workspace.self, from: Data(contentsOf: folder.appendingPathComponent("workspace.json")))
    guard [1,2].contains(value.formatVersion), UUID(uuidString: value.id) != nil else { throw WorkbenchError("工作区版本或编号无效。") }
    if let name = value.latestBackup {
        guard name.hasPrefix("backups/"), name.split(separator: "/").count == 2 else { throw WorkbenchError("备份路径无效。") }
        let file = folder.appendingPathComponent(name).resolvingSymlinksInPath()
        guard file.deletingLastPathComponent() == folder.appendingPathComponent("backups").resolvingSymlinksInPath() else { throw WorkbenchError("备份不在本工作区内。") }
    }
    if value.formatVersion == 2 {
        guard let module = value.external, module.id.range(of:"^[a-z][a-z0-9-]*$",options:.regularExpression) != nil,
              let business = value.businessBackup, business.directory.hasPrefix("backups/"), business.directory.split(separator:"/").count == 2,
              folder.appendingPathComponent(business.directory).resolvingSymlinksInPath().deletingLastPathComponent() == folder.appendingPathComponent("backups").resolvingSymlinksInPath() else {
            throw WorkbenchError("业务工作区缺少成对备份说明，原资料未修改。")
        }
        for name in business.files { _ = try businessFile(folder.appendingPathComponent(business.directory),name:name) }
    }
    return value
}

func businessFile(_ directory: URL, name: String) throws -> URL {
    let file = directory.appendingPathComponent(name).resolvingSymlinksInPath()
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
          file.deletingLastPathComponent() == directory.resolvingSymlinksInPath(),
          try file.resourceValues(forKeys:[.isRegularFileKey]).isRegularFile == true else {
        throw WorkbenchError("业务备份文件缺失或离开了指定目录，未覆盖已有资料。")
    }
    return file
}

func createWorkspace(_ folder: URL, backup: URL?) throws -> Workspace {
    var source: Workspace?, database = backup
    if let backup {
        if backup.lastPathComponent == "workspace.json" {
            let value = try loadWorkspace(backup.deletingLastPathComponent())
            guard let latest = value.latestBackup else { throw WorkbenchError("这个工作区尚无完成备份。") }
            source = value; database = backup.deletingLastPathComponent().appendingPathComponent(latest)
        }
        try validateBackup(database!)
        if source?.businessBackup == nil {
            let count = try runSQLite(database!,"SELECT count(*) FROM attributes WHERE name='workbenchExternal' AND isDeleted=0;",immutable:true)
            guard count == "0" else { throw WorkbenchError("业务工作台必须选择 workspace.json 成对恢复，不能只恢复 .db。") }
        }
    }
    if fm.fileExists(atPath: folder.path) {
        guard try fm.contentsOfDirectory(atPath: folder.path).filter({ $0 != ".DS_Store" }).isEmpty else {
            throw WorkbenchError("新建或恢复请选择一个空文件夹；已有资料不会被覆盖。")
        }
    } else { try fm.createDirectory(at: folder, withIntermediateDirectories: true) }
    try fm.setAttributes([.posixPermissions:0o700],ofItemAtPath:folder.path)
    try fm.createDirectory(at: folder.appendingPathComponent("backups"), withIntermediateDirectories: true)
    var workspace = Workspace()
    if let database {
        let name = "backups/restored-\(UUID().uuidString).db"
        try fm.copyItem(at: database, to: folder.appendingPathComponent(name))
        workspace.latestBackup = name
        if let business = source?.businessBackup, let module = source?.external, let backup {
            let directory = String(name.dropLast(3)) + "-state"
            try fm.createDirectory(at:folder.appendingPathComponent(directory),withIntermediateDirectories:true)
            for file in business.files {
                let original = try businessFile(backup.deletingLastPathComponent().appendingPathComponent(business.directory),name:file)
                try fm.copyItem(at:original,to:folder.appendingPathComponent(directory).appendingPathComponent(file))
            }
            workspace.formatVersion = 2; workspace.external = module
            workspace.businessBackup = BusinessBackup(directory:directory,files:business.files)
        }
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
        if let business = workspace.businessBackup, let module = workspace.external {
            let target = runtime.appendingPathComponent("external-state/" + module.id)
            try fm.createDirectory(at:target,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            for name in business.files {
                try fm.copyItem(at:businessFile(folder.appendingPathComponent(business.directory),name:name),to:target.appendingPathComponent(name))
            }
        }
    }
    let config = runtime.appendingPathComponent("data/config.ini")
    if !fm.fileExists(atPath: config.path) {
        try "[General]\ninstanceName=Trilium Workbench\n[Security]\nbackendScriptingEnabled=true\n".write(to: config, atomically: true, encoding: .utf8)
    }
    try writeJSON(LocalState(baseBackup: workspace.latestBackup), stateFile)
    return runtime
}

func publishWorkspace(_ folder: URL, workspace: Workspace, runtime: URL, external: ExternalWorkbench? = nil) throws -> Workspace {
    let temporary = runtime.appendingPathComponent("export.partial.db")
    if fm.fileExists(atPath: temporary.path) { try fm.removeItem(at: temporary) }
    defer { try? fm.removeItem(at: temporary) }
    // SQLite's native backup includes committed WAL pages; never copy a live document.db.
    _ = try runSQLite(runtime.appendingPathComponent("data/document.db"), ".backup export.partial.db", directory: runtime)
    if external != nil {
        // Only the exported copy drops this launcher's machine-local ETAPI credential.
        let name = "Trilium Workbench " + workspace.id
        _ = try runSQLite(temporary,"PRAGMA secure_delete=ON; DELETE FROM entity_changes WHERE entityName='etapi_tokens' AND entityId IN (SELECT etapiTokenId FROM etapi_tokens WHERE name='\(name)'); DELETE FROM etapi_tokens WHERE name='\(name)'; VACUUM;")
    }
    try validateBackup(temporary)
    let name = "backups/workspace-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString).db"
    let final = folder.appendingPathComponent(name), partial = folder.appendingPathComponent(name + ".part")
    var updated = workspace; updated.latestBackup = name
    do {
        try fm.copyItem(at: temporary, to: partial)
        try fm.moveItem(at: partial, to: final)
        if let external {
            let directory = String(name.dropLast(3)) + "-state", staging = folder.appendingPathComponent(directory + ".part")
            try fm.createDirectory(at:staging,withIntermediateDirectories:true)
            var files: [String] = []
            for file in external.stateFiles {
                if !fm.fileExists(atPath:external.stateDirectory.appendingPathComponent(file).path) {
                    guard workspace.businessBackup?.files.contains(file) != true else { throw WorkbenchError("业务状态文件缺失，本次未更新完成备份。") }; continue
                }
                try fm.copyItem(at:businessFile(external.stateDirectory,name:file),to:staging.appendingPathComponent(file)); files.append(file)
            }
            try fm.moveItem(at:staging,to:folder.appendingPathComponent(directory))
            updated.formatVersion = 2; updated.external = external.reference
            updated.businessBackup = BusinessBackup(directory:directory,files:files)
        }
    } catch { try? fm.removeItem(at: partial); throw error }
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

func launchTrilium(_ app: URL, runtime: URL, debugging: Bool, port fixedPort: Int? = nil, bindings: [String:Any] = [:]) throws -> Process {
    guard Bundle(url: app)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == triliumVersion else {
        throw WorkbenchError("本轮适配 Trilium \(triliumVersion)，请选择同版应用；不会替换原应用。")
    }
    let process = Process(), port = try fixedPort ?? freePort()
    process.executableURL = app.appendingPathComponent("Contents/MacOS/trilium")
    var env = ProcessInfo.processInfo.environment
    for (key, dir) in [("TRILIUM_DATA_DIR","data"),("TRILIUM_ELECTRON_DATA_DIR","electron"),("TRILIUM_BACKUP_DIR","backups"),("TRILIUM_LOG_DIR","log"),("TRILIUM_TMP_DIR","tmp")] {
        env[key] = runtime.appendingPathComponent(dir).path
    }
    env["TRILIUM_PORT"] = String(port)
    env["TRILIUM_WORKBENCH_BINDINGS"] = String(decoding:try JSONSerialization.data(withJSONObject:bindings),as:UTF8.self)
    process.environment = env
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

func executeBackend(_ port: Int, script: String, params: [Any]) async throws -> Any {
    let payload = try jsLiteral(["script":script,"params":params,"startNoteId":"twBootstrap","currentNoteId":"twBootstrap","originEntityName":"notes","originEntityId":"root","transactional":true] as [String:Any])
    return try await evaluate(port,expression:"""
    (async()=>{const r=await fetch('api/script/exec',{method:'POST',headers:{...glob.getHeaders(),'Content-Type':'application/json'},body:JSON.stringify(\(payload))});const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'工作包装配未完成');return result.executionResult;})()
    """)
}

func prepareExternal(_ external: ExternalWorkbench, port: Int, resources: URL, workspaceId: String) async throws -> String {
    var ready = false
    for _ in 0..<300 {
        if let value = try? await evaluate(port,expression:"typeof glob !== 'undefined' && glob.dbInitialized === true && typeof glob.getHeaders === 'function'"), value as? Bool == true { ready = true; break }
        try await Task.sleep(nanoseconds:100_000_000)
    }
    guard ready else { throw WorkbenchError("工作区页面尚未就绪，未修改业务资料。") }
    let bundle = try JSONSerialization.jsonObject(with:Data(contentsOf:resources.appendingPathComponent("bundle.json"))) as! [String:Any]
    let bootstrap = try String(contentsOf:resources.appendingPathComponent("bootstrap.js"),encoding:.utf8)
    _ = try await executeBackend(port,script:bootstrap,params:[bundle])
    let install = (bundle["notes"] as! [[String:Any]]).first { $0["noteId"] as? String == "twInstaller" }!["content"] as! String
    _ = try await executeBackend(port,script:install,params:[try external.package(resources:resources)])
    _ = try await executeBackend(port,script:"function markBusinessWorkspace(){api.getNote('root').setLabel('workbenchFormat','2');return true;}",params:[])
    let renderer = try String(contentsOf:resources.appendingPathComponent("external.js"),encoding:.utf8)
    _ = try await executeBackend(port,script:"function refreshRenderer(id,source,dataId){api.getNote(id).setContent(source);const data=api.getNote(dataId);data.setLabel('workbenchInternal','true');const archived=data.getLabel('archived')||data.addLabel('archived');archived.isInheritable=true;archived.save();return true;}",params:[external.reference.rootId + "UI",renderer,external.reference.dataId])
    if fm.fileExists(atPath:external.runtime.appendingPathComponent("etapi.json").path) { return try localEtapiToken(external.runtime) }
    let name = try jsLiteral("Trilium Workbench " + workspaceId)
    let result = try await evaluate(port,expression:"""
    (async()=>{const r=await fetch('api/etapi-tokens',{method:'POST',headers:{...glob.getHeaders(),'Content-Type':'application/json'},body:JSON.stringify({tokenName:\(name)})});if(!r.ok)throw new Error('本机 API 连接未完成');return (await r.json()).authToken;})()
    """)
    guard let token = result as? String, !token.isEmpty else { throw WorkbenchError("本机 API 连接未完成。") }
    try writePrivateJSON(["authToken":token],external.runtime.appendingPathComponent("etapi.json"))
    return token
}

func localEtapiToken(_ runtime: URL) throws -> String {
    guard let key = try JSONSerialization.jsonObject(with:Data(contentsOf:runtime.appendingPathComponent("etapi.json"))) as? [String:String], let token = key["authToken"], !token.isEmpty else {
        throw WorkbenchError("本机工作台连接文件无效，已有业务资料保留。")
    }
    return token
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
    var external: ExternalWorkbench?
    var runtimeLock: Int32 = -1
    var progress: NSWindow?
    var exitSignal: DispatchSourceSignal?
    var closing = false
    var externalSelection: URL?
    let args = CommandLine.arguments
    var testing: Bool { args.contains("--testing") }
    var cli: Bool { args.contains("--new") || args.contains("--open") }
    func option(_ name: String) -> String? { guard let index=args.firstIndex(of:name), index+1<args.count else { return nil }; return args[index+1] }
    func file(_ path: String) -> URL { URL(fileURLWithPath:path).standardizedFileURL.resolvingSymlinksInPath() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGUSR1,SIG_IGN)
        exitSignal = DispatchSource.makeSignalSource(signal:SIGUSR1,queue:.main)
        exitSignal?.setEventHandler { [weak self] in Task { @MainActor in await self?.managedExit() } }
        exitSignal?.resume()
        Task { do { try await start() } catch { await fail(error) } }
    }

    func managedExit() async {
        guard !closing, let child, child.isRunning else { return }; closing = true
        showProgress("正在完成已提交的操作并保存…\n请等待工作区保存完成。")
        do { try await external?.stop(); terminateOwnedProcess(child) }
        catch { await fail(error) }
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
        external = try ExternalWorkbench(runtime:runtime,configuration:option("--external-config").map(file) ?? externalSelection)
        if workspace.external != nil && external == nil && !cli, let selection = chooseExternal() {
            external = try ExternalWorkbench(runtime:runtime,configuration:selection)
        }
        if let expected = workspace.external {
            guard let external, external.reference == expected else { throw WorkbenchError("这个工作区需要同版本的本机业务工作包；请选择连接文件，不能只打开数据库冒充业务恢复。") }
        }
        let app=try triliumApp()
        if !cli { showProgress() }
        let isNew = workspace.latestBackup == nil && !fm.fileExists(atPath:runtime.appendingPathComponent("workbench-ready").path)
        let triliumPort = try freePort(), keyFile = runtime.appendingPathComponent("etapi.json")
        let hostVersion = Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as! String
        let hostMarker = runtime.appendingPathComponent("external-host-version")
        let needsExternalSetup = external != nil && (!fm.fileExists(atPath:keyFile.path) || (try? String(contentsOf:hostMarker,encoding:.utf8)) != hostVersion || option("--external-config") != nil || externalSelection != nil)
        var bindings: [String:Any] = [:]
        if let external, !needsExternalSetup {
            try await external.start(triliumPort:triliumPort,etapiToken:localEtapiToken(runtime))
            bindings[external.reference.id] = external.binding
        }
        child=try launchTrilium(app,runtime:runtime,debugging:isNew || needsExternalSetup || testing,port:triliumPort,bindings:bindings)
        UserDefaults.standard.set(app.path, forKey: "triliumAppPath")
        if isNew {
            let port=try await debuggerPort(runtime,process:child!)
            try await initializeWorkspaceDatabase(port,resources:Bundle.main.resourceURL!)
            try Data().write(to:runtime.appendingPathComponent("workbench-ready"),options:.atomic)
        }
        if let external, needsExternalSetup {
            let port = try await debuggerPort(runtime,process:child!)
            let token = try await prepareExternal(external,port:port,resources:Bundle.main.resourceURL!,workspaceId:workspace.id)
            try hostVersion.write(to:hostMarker,atomically:true,encoding:.utf8)
            terminateOwnedProcess(child!); child!.waitUntilExit()
            try await external.start(triliumPort:triliumPort,etapiToken:token)
            child=try launchTrilium(app,runtime:runtime,debugging:testing,port:triliumPort,bindings:[external.reference.id:external.binding])
        } else if isNew && !testing {
            terminateOwnedProcess(child!); child!.waitUntilExit()
            child=try launchTrilium(app,runtime:runtime,debugging:false,port:triliumPort)
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
            Task { @MainActor in await self?.finished(ended,folder:folder,workspace:workspace,runtime:runtime) }
        }
        if !process.isRunning { await finished(process,folder:folder,workspace:workspace,runtime:runtime) }
    }

    func finished(_ process: Process, folder: URL, workspace: Workspace, runtime: URL) async {
        guard child === process else { return }; child=nil
        do {
            let log=(try? String(contentsOf:runtime.appendingPathComponent("launcher.log"),encoding:.utf8)) ?? ""
            if log.contains("already an instance running") { NSApp.terminate(nil); return }
            guard process.terminationStatus == 0 || process.terminationStatus == SIGTERM else { throw WorkbenchError("工作台异常退出，本机数据已保留，未覆盖可移植备份。") }
            try await external?.stop()
            _ = try publishWorkspace(folder,workspace:workspace,runtime:runtime,external:external)
            progress?.close()
            if cli { print("SAVED " + folder.path); fflush(stdout) }
            else {
                let alert=NSAlert(); alert.messageText="工作区已保存"
                alert.informativeText="完整备份已保存到：\n" + folder.path + "\n\n可以从这里的完成备份恢复；若使用同步文件夹，请等待该服务完成上传后再换机。"
                alert.addButton(withTitle:"完成"); alert.runModal()
            }
            NSApp.terminate(nil)
        } catch { await fail(error) }
    }

    func fail(_ error: Error) async {
        try? await external?.stop()
        if let child, child.isRunning { terminateOwnedProcess(child); child.waitUntilExit() }; child=nil
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
            let picker=NSOpenPanel(); picker.title="选择工作区 workspace.json，或无业务包的 .db 备份"; picker.allowedContentTypes=[.json,UTType(filenameExtension:"db") ?? .database]; picker.canChooseDirectories=false
            guard picker.runModal() == .OK, let url=picker.url else { return nil }; backup=url
        }
        let picker=NSOpenPanel(); picker.canChooseFiles=false; picker.canChooseDirectories=true; picker.canCreateDirectories=true
        let connect = NSButton(checkboxWithTitle:"连接本机已安装的业务工作包",target:nil,action:nil)
        connect.frame=NSRect(x:0,y:0,width:320,height:24); picker.accessoryView=connect
        picker.title = action == .alertSecondButtonReturn ? "选择已有工作区文件夹" : "选择一个新的空文件夹"
        guard picker.runModal() == .OK, let folder=picker.url else { return nil }
        if connect.state == .on { guard let selection=chooseExternal() else { return nil }; externalSelection=selection }
        return action == .alertSecondButtonReturn ? (folder,try loadWorkspace(folder)) : (folder,try createWorkspace(folder,backup:backup))
    }

    func chooseExternal() -> URL? {
        let picker=NSOpenPanel(); picker.title="选择本机工作包连接文件"; picker.message="连接文件可启动本机程序，请选择你信任的已安装工作包。"; picker.prompt="连接并运行"
        picker.allowedContentTypes=[.json]; picker.canChooseDirectories=false
        return picker.runModal() == .OK ? picker.url : nil
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

    func showProgress(_ message: String = "正在准备工作区…\n首次打开会调用 Trilium 原生初始化，请稍候。") {
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:420,height:130),styleMask:[.titled],backing:.buffered,defer:false)
        window.title="Trilium 工作台"
        let label=NSTextField(wrappingLabelWithString:message)
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
