import Foundation

struct ExternalReference: Codable, Equatable {
    let id: String
    let version: String
    let rootId: String
    let dataId: String
    let tableId: String
}

// ponytail: one managed service per workspace; add a list when a second service is needed.
final class ExternalWorkbench {
    let definition: [String: Any]
    let reference: ExternalReference
    let runtime: URL
    let stateDirectory: URL
    let stateFiles: [String]
    var process: Process?
    var binding: [String: Any] = [:]

    init?(runtime: URL, configuration: URL?) throws {
        let saved = runtime.appendingPathComponent("external.json")
        let file = configuration ?? saved
        guard fm.fileExists(atPath: file.path) else { return nil }
        guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any],
              value["formatVersion"] as? Int == 1,
              let id = value["id"] as? String, id.range(of: "^[a-z][a-z0-9-]*$", options: .regularExpression) != nil,
              let version = value["version"] as? String, !version.isEmpty,
              let rootId = value["rootId"] as? String, let dataId = value["dataId"] as? String, let tableId = value["tableId"] as? String,
              Set([rootId,dataId,tableId]).count == 3,
              [rootId,dataId,tableId].allSatisfy({ $0 != "root" && $0.range(of:"^[A-Za-z0-9][A-Za-z0-9_]{3,100}$",options:.regularExpression) != nil }),
              let command = value["command"] as? [String], command.count >= 2, command[0].hasPrefix("/"),
              fm.isExecutableFile(atPath: command[0]), command.contains("$CONFIG"),
              value["title"] is String, value["configuration"] is [String: Any],
              let routes = value["routes"] as? [String: String], !routes.isEmpty,
              let maxBytes = value["maxRequestBytes"] as? Int, maxBytes > 0,
              routes.allSatisfy({ $0.key.range(of:"^[a-z][a-z-]*$",options:.regularExpression) != nil && ["GET","POST"].contains($0.value) }),
              let files = value["stateFiles"] as? [String], !files.isEmpty,
              files.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") && !$0.contains("\\") }) else {
            throw WorkbenchError("本地工作包连接文件无效；已有资料没有修改。")
        }
        definition = value; reference = ExternalReference(id:id,version:version,rootId:rootId,dataId:dataId,tableId:tableId)
        self.runtime = runtime; stateFiles = files
        stateDirectory = runtime.appendingPathComponent("external-state/" + id, isDirectory:true)
        try fm.createDirectory(at:stateDirectory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        if configuration != nil { try writePrivateJSON(value, saved) }
    }

    func package(resources: URL) throws -> [String: Any] {
        let codeId = reference.rootId + "UI"
        let label: [String: Any] = ["type":"label","name":"workbenchExternal","value":reference.id]
        let source = try String(contentsOf:resources.appendingPathComponent("external.js"),encoding:.utf8)
        return ["format":"trilium-workbench-package","schemaVersion":1,"id":reference.id,"version":reference.version,
                "title":definition["title"]!,"description":definition["description"] ?? "本机工作包，资料保存在当前工作区。",
                "rootId":reference.rootId,"rendererId":codeId,"dataId":reference.dataId,"notes":[
                    ["noteId":reference.rootId,"parentNoteId":"root","title":definition["title"]!,"type":"render","content":"","attributes":[label]],
                    ["noteId":codeId,"parentNoteId":reference.rootId,"title":"本地工作包界面.js","type":"code","mime":"application/javascript;env=frontend","content":source,"attributes":[["type":"label","name":"scriptEnv","value":"frontend"]]],
                    ["noteId":reference.tableId,"parentNoteId":reference.rootId,"title":definition["tableTitle"] ?? "资料列表","type":"render","content":"","attributes":[label,["type":"relation","name":"renderNote","value":codeId]]],
                    ["noteId":reference.dataId,"parentNoteId":reference.rootId,"title":"原始资料表","type":"code","mime":"text/plain","content":definition["initialContent"] ?? "","attributes":[["type":"label","name":"workbenchInternal","value":"true"]]]
                ]]
    }

    func start(triliumPort: Int, etapiToken: String) async throws {
        let token = UUID().uuidString + UUID().uuidString
        let values: [String: Any] = ["triliumUrl":"http://127.0.0.1:\(triliumPort)","etapiToken":etapiToken,"port":0,"token":token,"dataId":reference.dataId]
        func resolve(_ value: Any) throws -> Any {
            if let object = value as? [String: Any] {
                if let key = object["$runtime"] as? String, object.count == 1 {
                    guard let result = values[key] else { throw WorkbenchError("连接文件引用了未知运行参数。") }; return result
                }
                if let name = object["$state"] as? String, object.count == 1 {
                    guard stateFiles.contains(name) else { throw WorkbenchError("连接文件引用了未声明的业务文件。") }
                    return stateDirectory.appendingPathComponent(name).path
                }
                return try object.mapValues { try resolve($0) }
            }
            if let array = value as? [Any] { return try array.map { try resolve($0) } }
            return value
        }
        let file = runtime.appendingPathComponent("external-runtime.json"), marker = URL(fileURLWithPath:file.path + ".launch-url")
        try writePrivateJSON(try resolve(definition["configuration"]!),file)
        if fm.fileExists(atPath:marker.path) { try fm.removeItem(at:marker) }
        let command = definition["command"] as! [String], child = Process()
        child.executableURL = URL(fileURLWithPath:command[0]); child.arguments = command.dropFirst().map { $0 == "$CONFIG" ? file.path : $0 }
        var environment = ProcessInfo.processInfo.environment
        for (key,value) in definition["environment"] as? [String:String] ?? [:] { environment[key] = value }
        child.environment = environment
        let log = runtime.appendingPathComponent("external.log")
        fm.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600])
        let output = try FileHandle(forWritingTo:log); child.standardOutput = output; child.standardError = output
        try child.run(); try output.close(); process = child
        for _ in 0..<300 {
            if !child.isRunning { throw WorkbenchError("本地业务服务启动失败，已有资料保留；请检查本机运行记录。") }
            if let text = try? String(contentsOf:marker,encoding:.utf8), let url = URLComponents(string:text.trimmingCharacters(in:.whitespacesAndNewlines)),
               url.scheme == "http", url.host == "127.0.0.1", let port = url.port, url.fragment == token {
                binding = ["origin":"http://127.0.0.1:\(port)","token":token,"routes":definition["routes"]!,"maxRequestBytes":definition["maxRequestBytes"]!,"rootId":reference.rootId,"launcherPid":Int(ProcessInfo.processInfo.processIdentifier)]
                return
            }
            try await Task.sleep(nanoseconds:100_000_000)
        }
        throw WorkbenchError("本地业务服务尚未就绪，已有资料保留。")
    }

    func stop() async throws {
        guard let process else { return }
        terminateOwnedProcess(process)
        // The business process drains accepted requests; never kill it mid-write to meet a timer.
        while process.isRunning { try await Task.sleep(nanoseconds:100_000_000) }
        guard process.terminationStatus == 0 else { throw WorkbenchError("业务服务未正常保存，本机文件与原备份已保留，请先核对。") }
        self.process = nil
    }
}

func writePrivateJSON(_ value: Any, _ file: URL) throws {
    try JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]).write(to:file,options:.atomic)
    try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
}
