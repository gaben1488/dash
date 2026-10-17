"""Source-only capture stays private and never follows links into service data."""
import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


class CapsuleTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('runtime_source_capsule.py')
        self.assertTrue(path.is_file(), 'Private installed-source recovery is missing')
        spec = importlib.util.spec_from_file_location('capsule', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_code_only_excludes_configuration_and_business_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'code.py').write_text('value = 1')
            (root / '.env').write_text('private')
            (root / 'rows.json').write_text('private')
            result = self.module.code_archive({'code': root})
            with tarfile.open(fileobj=io.BytesIO(result), mode='r:gz') as archive:
                self.assertEqual(archive.getnames(), ['code/code.py'])

    def test_links_cannot_reach_other_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'outside.py').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError, 'SOURCE_SYMLINK'):
                self.module.code_archive({'code': root})

    def test_private_key_material_cannot_enter_a_source_capsule(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'unsafe.py').write_text('-----BEGIN PRIVATE KEY-----\n' + 'a' * 100)
            with self.assertRaisesRegex(ValueError, 'SOURCE_PRIVATE_KEY'):
                self.module.code_archive({'code': root})

    def test_only_owned_services_can_be_captured(self):
        item = {'Name': '/aemr-server-1', 'Image': 'sha256:' + 'a' * 64,
                'Config': {'Labels': {'com.docker.compose.project': 'aemr',
                                      'com.docker.compose.service': 'server'}}}
        self.assertTrue(self.module.owned(item, 'server'))
        item['Config']['Labels']['com.docker.compose.project'] = 'other'
        self.assertFalse(self.module.owned(item, 'server'))

    def test_new_code_during_capture_rejects_partial_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'code.py').write_text('value = 1')
            addfile = tarfile.TarFile.addfile

            def adding_file(archive, *args, **kwargs):
                result = addfile(archive, *args, **kwargs)
                (root / 'new.py').write_text('value = 2')
                return result

            with (patch.object(tarfile.TarFile, 'addfile', adding_file),
                  self.assertRaisesRegex(ValueError, 'SOURCE_CHANGED_DURING_CAPTURE')):
                self.module.code_archive({'code': root})

    def test_replaced_service_rejects_old_still_inspectable_container(self):
        reads = {}

        def command(args, **kwargs):
            if args[:2] == ['docker', 'exec']:
                return b'private source archive'
            if args[:2] == ['docker', 'inspect']:
                target = args[2]
                service = target.removeprefix('aemr-').removesuffix('-1')
                if target.startswith('old-'):
                    service = target.removeprefix('old-')
                reads[target] = reads.get(target, 0) + 1
                replaced = target == 'aemr-server-1' and reads[target] > 1
                item = {'Name': f'/aemr-{service}-1', 'Image': 'sha256:' + 'a' * 64,
                        'Id': ('new-' if replaced else 'old-') + service,
                        'State': {'StartedAt': 'unchanged'}, 'RestartCount': 0,
                        'Config': {'Labels': {'com.docker.compose.project': 'aemr',
                                             'com.docker.compose.service': service}}}
                return json.dumps([item]).encode()
            raise AssertionError('Encryption must not run for replaced runtime')

        with (tempfile.TemporaryDirectory() as directory,
              patch.object(self.module, 'command', command),
              self.assertRaisesRegex(ValueError, 'SOURCE_RUNTIME_CHANGED')):
            self.module.capture(Path(directory) / 'recipient.pem')

    def test_authenticated_capsule_roundtrip_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plain, encrypted, restored = (root / name for name in ('plain', 'encrypted', 'restored'))
            key, cert = root / 'key.pem', root / 'cert.pem'
            plain.write_bytes(b'synthetic source only')

            def run(args):
                return subprocess.run(['openssl', *args], capture_output=True, check=False)

            self.assertEqual(run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                                  '-out', str(cert), '-days', '1', '-subj', '/CN=Synthetic test']).returncode, 0)
            self.assertEqual(run(['cms', '-encrypt', '-aes-256-gcm', '-binary', '-outform', 'DER',
                                  '-in', str(plain), '-out', str(encrypted), str(cert)]).returncode, 0)
            decrypt = ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(encrypted),
                       '-inkey', str(key), '-out', str(restored)]
            self.assertEqual(run(decrypt).returncode, 0)
            self.assertEqual(restored.read_bytes(), plain.read_bytes())
            corrupted = bytearray(encrypted.read_bytes())
            corrupted[-1] ^= 1
            encrypted.write_bytes(corrupted)
            self.assertNotEqual(run(decrypt).returncode, 0)
            # OpenSSL may create partial output on failure: consumers must check
            # returncode before opening or extracting any decrypted archive.

    def test_transport_does_not_lose_capsule_to_short_secret_masking(self):
        # The valid base64 word "aemr" can match a short SSH username. GitHub
        # masking destroys even encrypted bytes; dot framing separates chars.
        ciphertext = bytes.fromhex('69e9ab')

        def command(args, **kwargs):
            if args[:2] == ['docker', 'exec']:
                return b'synthetic source'
            if args[:2] == ['docker', 'inspect']:
                service = args[2].removeprefix('aemr-').removesuffix('-1')
                return json.dumps([{'Name': f'/aemr-{service}-1', 'Image': 'sha256:' + 'a' * 64,
                                    'Id': service, 'State': {'StartedAt': 'same'}, 'RestartCount': 0,
                                    'Config': {'Labels': {'com.docker.compose.project': 'aemr',
                                                         'com.docker.compose.service': service}}}]).encode()
            if args[:2] == ['openssl', 'cms']:
                Path(args[args.index('-out') + 1]).write_bytes(ciphertext)
                return b''
            raise AssertionError('Unexpected command')

        output = io.StringIO()
        with (tempfile.TemporaryDirectory() as directory,
              patch.object(self.module, 'command', command), redirect_stdout(output)):
            self.module.capture(Path(directory) / 'cert.pem')
        text = output.getvalue().replace('aemr', '***')
        line = next((line for line in text.splitlines() if line.startswith('CAPSULE_DOTTED_CHUNK_0=')), '')
        self.assertTrue(line, 'Capsule transport must separate encoded characters')
        encoded = line.split('=', 1)[1].replace('.', '')
        self.assertEqual(self.module.base64.b64decode(encoded, validate=True), ciphertext)


if __name__ == '__main__':
    unittest.main()
