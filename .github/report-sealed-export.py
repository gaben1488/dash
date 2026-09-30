"""Temporary private review transport: no credentials or raw business text are logged.
Only the immutable, verified latest publication is exported. AES256-GCM data key
is wrapped with the session public RSA key. The private key never leaves the reviewer.
"""
import hashlib
import io
import json
import os
import shutil
import sqlite3
import struct
import tarfile
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from procurement_engine.publication_store import PublicationStore

PUBLIC = b'''-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA2nVlyCkX3/wR2jaQ47Bp
RodzjiIpSbK6C8FJnEDzdJNl3g2LsHUzXFwEtsmtEKYilSH//nJbbK5NEwHla5+s
yg5wxVBkv3CJOHZkNT/GqWprZcMAx/09thj7gGxqL2MEhInF5XU85FAdGMKjFlAf
s6hRZvCSe5ztk76rmfb9X680/CB8MVjjQPyKMuayuxC7Hvk2aso9TJ9APlsnPuts
S2eDGt6+WrF+2sYtwHtfX/a9bueFb3byO8GpC8RpWKCTZW6qjFNnlmd+E1FBcKjk
NZcvto3Va0KvzfYci/HPOg/3XRXOL5/N1BYgHe52nNoeaiRW4C+VZWuu8/tTL3bL
IQ06BwvQiEfCECRzGu6xqJpPNqCxHa70yiExi1iQw0d2mse7d9TxKQBcgRV1YBVQ
038X9lTbq3F9xNTaPUNyGgvbKleXkSbPYi32aJB8EiujPCtBqnouVy3/Q166SXgl
CqhPn/1fD4jxGxkL3daEIQAscEXGlvJIL4oY1XbYp7YHAgMBAAE=
-----END PUBLIC KEY-----
'''
AAD = b'aemr-one-verified-release-review-v1'
MAX_BYTES = 128 * 1024 * 1024


def fingerprint(path):
    if not path.exists(): return None
    if path.is_symlink() or not path.is_file(): raise ValueError('UNSAFE_PATH')
    stat = path.stat()
    with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return stat.st_ino, stat.st_size, stat.st_mtime_ns, digest


def run():
    public = serialization.load_pem_public_key(PUBLIC)
    if not isinstance(public, rsa.RSAPublicKey) or public.key_size < 3072: raise ValueError('PUBLIC_KEY_INVALID')
    state = Path('/app/packages/server/data/reports')
    store = PublicationStore(state / 'published', readonly=True)
    source = store.database_path
    paths = [source, source.with_name(source.name + '-wal')]
    with tempfile.TemporaryDirectory(prefix='sealed-catalog-') as folder:
        receipt = None
        catalog = Path(folder) / source.name
        for _ in range(3):
            for path in Path(folder).iterdir(): path.unlink()
            try:
                before = [fingerprint(path) for path in paths]
                if before[0] is None: raise ValueError('PUBLICATION_NOT_FOUND')
                for path, stamp in zip(paths, before):
                    if stamp is not None: shutil.copyfile(path, Path(folder) / path.name)
                if before != [fingerprint(path) for path in paths]: continue
            except FileNotFoundError: continue
            connection = sqlite3.connect(catalog)
            try:
                if connection.execute('PRAGMA quick_check').fetchone() != ('ok',): raise ValueError('CATALOG_CORRUPT')
                connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            finally: connection.close()
            store.database_path = catalog
            receipt = store.latest()
            break
        if receipt is None: raise ValueError('PUBLICATION_NOT_FOUND')
        release = store.releases / receipt['release_id']
        selected = [path for path in release.rglob('*') if path.is_file()]
        if not selected or len(selected) > 2000: raise ValueError('RELEASE_BOUNDS')
        if any(path.is_symlink() or not path.resolve().is_relative_to(release.resolve()) for path in selected): raise ValueError('UNSAFE_PATH')
        total = sum(path.stat().st_size for path in selected)
        if total > MAX_BYTES: raise ValueError('RELEASE_TOO_LARGE')
        before = {str(path.relative_to(release)): fingerprint(path) for path in selected}
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for path in sorted(selected):
                archive.add(path, arcname=str(Path('published/releases') / receipt['release_id'] / path.relative_to(release)), recursive=False)
            # Contains catalog metadata only, not credentials. The release selector
            # below limits replay to the sole exported immutable bundle.
            private_catalog = Path(folder) / 'selected.sqlite'
            src = sqlite3.connect(catalog); dst = sqlite3.connect(private_catalog)
            try:
                src.backup(dst)
                dst.execute('DELETE FROM publications WHERE release_id <> ?', (receipt['release_id'],))
                dst.commit()
                dst.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            finally:
                src.close(); dst.close()
            archive.add(private_catalog, arcname='published/publications.sqlite', recursive=False)
        if before != {str(path.relative_to(release)): fingerprint(path) for path in selected}: raise ValueError('RELEASE_CHANGED')
        plaintext = output.getvalue()
        if len(plaintext) > MAX_BYTES: raise ValueError('EXPORT_TOO_LARGE')
        key = AESGCM.generate_key(bit_length=256); nonce = os.urandom(12)
        wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=AAD))
        encrypted = AESGCM(key).encrypt(nonce, plaintext, AAD)
        envelope = b'AEMRSEAL1' + struct.pack('>I', len(wrapped)) + wrapped + nonce + encrypted
        path = Path('/encrypted-output/release.enc')
        with path.open('xb') as stream: stream.write(envelope)
        os.chmod(path, 0o600)
        print(json.dumps({'export': 'ENCRYPTED', 'sha256': hashlib.sha256(envelope).hexdigest(), 'encrypted_bytes': len(envelope)}))

try:
    run()
except Exception as error:
    print(json.dumps({'export': 'FAIL', 'exception_class': type(error).__name__}))
    raise SystemExit(2)
