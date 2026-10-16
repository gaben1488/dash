"""The live RW-mount metadata reader must not clone a large catalog into tmpfs."""
import contextlib
import io
import json
import sqlite3
import sys
import tempfile
import textwrap
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class BrowserCatalogMetadataTests(unittest.TestCase):
    def test_committed_wal_word_hashes_are_read_without_scratch_or_data_writes(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text()
        section=workflow.split('  browser-readback:',1)[1].split('  observe:',1)[0]
        program='import json,re,sqlite3'+textwrap.dedent(section.split("program='''import json,re,sqlite3",1)[1].split("'''",1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            database=Path(temporary)/'publications.sqlite';rid='REL-'+'a'*64
            with sqlite3.connect(database) as writer:
                writer.execute('PRAGMA journal_mode=WAL');writer.execute('PRAGMA wal_autocheckpoint=0')
                writer.execute('CREATE TABLE publications(release_id TEXT,files TEXT)')
                names={'main_report.docx':'b'*64,'management_report.docx':'c'*64,'operational_report.docx':'d'*64}
                writer.execute('INSERT INTO publications VALUES(?,?)',(rid,json.dumps(names)));writer.commit()
                wal=Path(str(database)+'-wal');self.assertTrue(wal.exists())
                before=(database.read_bytes(),wal.read_bytes())
                class Store:
                    def __init__(self,root,*,readonly):
                        if not readonly:raise AssertionError('Read-only store required')
                        self.database_path=database
                    def reader_lease(self):return contextlib.nullcontext()
                # Native store owns the real lease in production; this fixture
                # isolates the WAL/readonly query and its scratch boundary.
                parent=types.ModuleType('procurement_engine');parent.__path__=[]
                module=types.ModuleType('procurement_engine.publication_store');module.PublicationStore=Store
                with (
                    patch.dict(sys.modules,{'procurement_engine':parent,'procurement_engine.publication_store':module}),
                    contextlib.redirect_stdout(io.StringIO()) as out,
                    patch.object(tempfile,'TemporaryDirectory',side_effect=AssertionError('No full catalog clone for metadata')),
                ):
                    exec(compile(program,'<reviewed-browser-word-metadata>','exec'),{})  # noqa: S102 - trusted workflow code
                self.assertEqual(json.loads(out.getvalue()),{rid:{'main':'b'*64,'supplement':'c'*64,'operational':'d'*64}})
                self.assertEqual((database.read_bytes(),wal.read_bytes()),before)


if __name__=='__main__':unittest.main()
