"""An external JSON client. All inputs and credentials belong to its temporary fixture."""
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import uuid


def digest(value):
    return sha256(value.encode()).hexdigest()


def fixture(data):
    token = str(uuid.uuid4())
    lib = data / "library"
    lib.mkdir()
    with sqlite3.connect(data / "external-connections.sqlite3") as conn:
        conn.execute("CREATE TABLE grants(id TEXT, name TEXT, space TEXT, digest TEXT)")
        conn.execute("INSERT INTO grants VALUES('1','Synthetic client','inbox',?)", (digest(token),))
    with sqlite3.connect(lib / "catalog.sqlite3") as catalog:
        catalog.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA user_version=4;
            CREATE TABLE documents(id TEXT, project TEXT, path TEXT, title TEXT, status TEXT);
        """)
        workspaces = data / "workspaces"
        workspaces.mkdir()
        for space, text in [("inbox", "Autumn reading: eight meetings."), (str(uuid.uuid4()), "Private notes.")]:
            doc = str(uuid.uuid4())
            rel = f"documents/{doc}/Dates.md"
            root = lib / "projects" / space
            target = root / rel
            target.parent.mkdir(parents=True)
            target.write_text(text)
            catalog.execute("INSERT INTO documents VALUES(?,?,?,'Dates.md','ready')", (doc, space, rel))
            with sqlite3.connect(workspaces / (digest(str(root.resolve())) + ".sqlite3")) as index:
                index.executescript("""
                    PRAGMA journal_mode=WAL;
                    PRAGMA user_version=3;
                    CREATE TABLE documents(path TEXT, title TEXT);
                    CREATE TABLE chunks(id INTEGER PRIMARY KEY, path TEXT, text TEXT, heading TEXT, start_line INTEGER, end_line INTEGER, hash TEXT);
                    CREATE VIRTUAL TABLE chunk_fts USING fts5(title,heading,field_path,text);
                """)
                index.execute("INSERT INTO documents VALUES(?,'Dates.md')", (rel,))
                index.execute("INSERT INTO chunks VALUES(1,?,?,'',1,1,?)", (rel, text, digest(text)))
                index.execute("INSERT INTO chunk_fts VALUES('Dates','','',?)", (text,))
    return token


def verify(binary, data, token):
    def command(*args, error=None):
        env = {**os.environ, "INKSTONE_CLI_FIXTURE_DIR": str(data), "INKSTONE_CLI_TOKEN": token}
        result = subprocess.run([binary, *args, "--json"], capture_output=True, timeout=15, env=env)
        if error:
            assert result.returncode and not result.stdout
            assert json.loads(result.stderr)["error"] == error
        else:
            assert result.returncode == 0, result.stderr
            reply = json.loads(result.stdout)
            assert reply["protocolVersion"] == 1
            return reply["result"]

    def fingerprints():
        # Read-only SQLite connections may create shared-memory lock files and an
        # empty WAL when opening a checkpointed WAL-mode database. Check every
        # durable byte, including any nonempty transaction log.
        return {
            p.relative_to(data): sha256(p.read_bytes()).digest()
            for p in data.rglob("*")
            if p.is_file() and not p.name.endswith("-shm")
            and not (p.name.endswith("-wal") and p.stat().st_size == 0)
        }

    before = fingerprints()
    result = command("search", "--space", "inbox", "--query", "reading")
    assert result["mode"] == "bm25"
    hits = result["results"]
    assert len(hits) == 1
    citation = hits[0]["ref"]
    source = command("read", "--space", "inbox", "--ref", citation)
    assert source["text"] == "Autumn reading: eight meetings."
    assert (source["startLine"], source["endLine"], source["version"]) == (1, 1, hits[0]["version"])
    command("read", "--space", str(uuid.uuid4()), "--ref", citation, error="denied")
    assert before == fingerprints()
    with sqlite3.connect(data / "external-connections.sqlite3") as grant_store:
        grant_store.execute("DELETE FROM grants")
    command("read", "--space", "inbox", "--ref", citation, error="denied")
    return f"{source['text']} [{source['title']} L{source['startLine']}]"


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        data = Path(temp)
        print(verify(sys.argv[1], data, fixture(data)))
