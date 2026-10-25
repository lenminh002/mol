import db


def test_save_list_get_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "runs.db")
    db.init()
    req = {"drug": "aspirin", "target": "COX-1"}
    first = db.save_run(req, {"summary": "a"}, [{"agent": "x", "tool": "t", "args": {}}], {"drug": "aspirin", "target": "COX-1"})
    second = db.save_run(req, {"summary": "b"}, [], None)  # same label replaces the older run

    runs = db.list_runs()
    assert [r["id"] for r in runs] == [second]
    assert runs[0]["label"] == "aspirin → COX-1"
    assert db.get_run(first) is None
    assert db.get_run(second)["result"] == {"summary": "b"}

    db.delete_run(second)
    assert db.list_runs() == []


def test_prunes_and_clears(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "runs.db")
    monkeypatch.setattr(db, "MAX_RUNS", 3)
    db.init()
    for i in range(5):
        db.save_run({"prompt": f"q{i}"}, {}, [], None)
    assert len(db.list_runs()) == 3
    db.clear_runs()
    assert db.list_runs() == []


def test_chat_is_stored_with_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "runs.db")
    db.init()
    run_id = db.save_run({"drug": "aspirin"}, {"summary": "a"}, [], None)
    assert db.get_run(run_id)["chat"] == []
    thread = [{"role": "user", "content": "why?"}, {"role": "assistant", "content": "because"}]
    db.save_chat(run_id, thread)
    assert db.get_run(run_id)["chat"] == thread
