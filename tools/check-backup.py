"""Read only a completed synthetic backup produced by check-ui.cjs."""
import json
from pathlib import Path
import sqlite3
import sys

project = Path(__file__).resolve().parent.parent
if len(sys.argv) == 3 and sys.argv[1] == "--business":
    manifest = Path(sys.argv[2]).resolve()
    workspace = json.loads(manifest.read_text())
    assert manifest.name == "workspace.json" and workspace["formatVersion"] == 2
    folder = manifest.parent
    backup = (folder / workspace["latestBackup"]).resolve()
    state = (folder / workspace["businessBackup"]["directory"]).resolve()
    assert backup.parent == state.parent == folder / "backups"
    assert state.name == backup.stem + "-state"
    for name in workspace["businessBackup"]["files"]:
        file = (state / name).resolve()
        assert name not in ("", ".", "..") and "/" not in name and "\\" not in name
        assert file.parent == state and file.is_file()
    with sqlite3.connect(backup.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        assert db.execute("pragma quick_check").fetchone()[0] == "ok"
        assert db.execute("select value from attributes where noteId='root' and name='workbenchFormat' and isDeleted=0").fetchone()[0] == "2"
        module = workspace["external"]
        assert db.execute("select value from attributes where noteId=? and name='workbenchExternal' and isDeleted=0", (module["rootId"],)).fetchone()[0] == module["id"]
        assert db.execute("select count(*) from notes where noteId in (?,?,?) and isDeleted=0", (module["rootId"], module["dataId"], module["tableId"])).fetchone()[0] == 3
        assert db.execute("select count(*) from etapi_tokens where name=?", ("Trilium Workbench " + workspace["id"],)).fetchone()[0] == 0
    print("PASS: completed business database, paired files and exported credential boundary.")
    sys.exit(0)
recovery = sys.argv[1:] == ["--recovery"]
report = json.loads((project / ("work/recovery-check.json" if recovery else "work/ui-check.json")).read_text())
backups = [report[k] for k in ("aBackup", "bBackup", "nativeBackup")] if recovery else [report["backup"]]
marker = report["expected"]["value"] if recovery else "示例学生一（已编辑）"
for name in backups:
    backup = Path(name)
    assert backup.is_relative_to(project / "work")
    with sqlite3.connect(backup.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        assert db.execute("pragma quick_check").fetchone()[0] == "ok"
        def content(note):
            return db.execute("select content from blobs where blobId=(select blobId from notes where noteId=?)", (note,)).fetchone()[0]
        assert json.loads(content("twYingSheet"))["workbook"]["sheets"]["students"]["cellData"]["1"]["0"]["v"] == marker
        assert db.execute("select value from attributes where noteId=? and name=? and isDeleted=0", ("twYing", "workbenchEnabled")).fetchone()[0] == "true"
        assert db.execute("select count(*) from notes where noteId in (?,?,?) and isDeleted=0", ("twCatalogData", "twYingUI", "twYingSheet")).fetchone()[0] == 3
        if recovery:
            assert json.loads(content("twYingPreparation")) == report["expected"]["preparation"]
            assert "刷新表格" in content("twYingUI")
            assert "信任这个工作包" in content("twCatalogUI")
            assert db.execute("select value from options where name='locale'").fetchone()[0] == "cn"
print(f"PASS: {len(backups)} completed backup(s), integrity and module/UI/data/preparation readback.")
