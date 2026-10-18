"""Build once, promote the exact CI images; no business data or Docker required."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).with_name('runtime_artifact.py')


class RuntimeArtifactTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Runtime artifact contract is missing')
        spec = importlib.util.spec_from_file_location('runtime_artifact', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.objects = self.root / 'artifact'
        self.objects.mkdir()
        self.sha = 'a' * 40
        self.images = []
        for role, digit in (('server', 'b'), ('web', 'c')):
            (self.objects / (role + '.tar.gz')).write_bytes((role + ' synthetic archive').encode())
            self.images.append({'Id': 'sha256:' + digit * 64, 'Os': 'linux', 'Architecture': 'amd64',
                                'RepoTags': [f'aemr-{role}:release-{self.sha}'],
                                'Config': {'Labels': {'org.opencontainers.image.revision': self.sha}}})
        for name in self.module.SOURCE_FILES:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic source')
        self.versions = {'node': 'v22.20.0', 'python': '3.11.0', 'rules': 'test-rules', 'renderer': 'test-renderer'}

    def produce(self):
        result = self.module.create(self.objects, self.sha, 123, 1, self.images, self.versions, self.root)
        (self.objects / 'manifest.json').write_text(json.dumps(result))
        return result

    def test_complete_artifact_verifies_and_loaded_images_keep_exact_identity(self):
        manifest = self.produce()
        self.assertEqual(self.module.verify(self.objects, self.sha, 123, 1), manifest)
        self.module.verify_loaded(manifest, self.images)
        self.module.verify(self.objects, self.sha, 123, 1, self.root)
        self.assertEqual(set(manifest['images']), {'server', 'web'})

    def test_other_source_run_attempt_corrupt_archive_extra_file_and_symlink_are_rejected(self):
        self.produce()
        for args in (('d' * 40, 123, 1), (self.sha, 124, 1), (self.sha, 123, 2)):
            with self.assertRaises(ValueError):
                self.module.verify(self.objects, *args)
        path = self.objects / 'server.tar.gz'
        original = path.read_bytes()
        path.write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            self.module.verify(self.objects, self.sha, 123, 1)
        path.write_bytes(original)
        extra = self.objects / 'unknown'
        extra.touch()
        with self.assertRaises(ValueError):
            self.module.verify(self.objects, self.sha, 123, 1)
        extra.unlink()
        path.unlink()
        path.symlink_to(self.objects / 'web.tar.gz')
        with self.assertRaises(ValueError):
            self.module.verify(self.objects, self.sha, 123, 1)

    def test_download_is_bound_to_the_immutable_artifact_run_and_zip_digest(self):
        self.produce()
        archive = self.root / 'artifact.zip'
        with zipfile.ZipFile(archive, 'w') as package:
            for file in self.objects.iterdir():
                package.write(file, file.name)
        metadata = {'id': 42, 'name': 'runtime-' + self.sha, 'expired': False,
                    'workflow_run': {'id': 123, 'head_sha': self.sha},
                    'digest': 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()}
        target = self.root / 'download'
        self.module.unpack(target, archive, metadata, self.sha, 123, 1)
        self.module.verify(target, self.sha, 123, 1, self.root)
        for patch in ({'expired': True}, {'digest': 'sha256:' + '0' * 64},
                      {'workflow_run': {'id': 124, 'head_sha': self.sha}}):
            with self.assertRaises(ValueError):
                self.module.unpack(self.root / 'rejected', archive, {**metadata, **patch}, self.sha, 123, 1)

    def test_retry_fetches_the_existing_artifact_by_id_from_an_earlier_successful_job_attempt(self):
        self.produce()
        archive = self.root / 'source.zip'
        with zipfile.ZipFile(archive, 'w') as package:
            for file in self.objects.iterdir():
                package.write(file, file.name)
        body = archive.read_bytes()
        metadata = {'id': 42, 'name': 'runtime-' + self.sha, 'expired': False,
                    'workflow_run': {'id': 123, 'head_sha': self.sha},
                    'digest': 'sha256:' + hashlib.sha256(body).hexdigest()}
        calls = []

        def api(path, output=None):
            calls.append(path)
            if output is not None:
                output.write_bytes(body)
                return None
            return {'total_count': 1, 'artifacts': [metadata]}

        destination = self.root / 'retry'
        value = self.module.fetch(destination, self.sha, 123, 2, api=api)
        self.assertEqual(value['manifest']['ci']['attempt'], 1)
        self.assertEqual(value['artifact']['id'], 42)
        self.assertTrue(calls[-1].endswith('/actions/artifacts/42/zip'))
        self.module.verify(destination, self.sha, 123, 1, self.root)

    def test_zip_paths_extra_members_and_changed_schema_sources_are_rejected(self):
        self.produce()
        source = self.root / self.module.SOURCE_FILES[0]
        source.write_text('different source')
        with self.assertRaises(ValueError):
            self.module.verify(self.objects, self.sha, 123, 1, self.root)
        archive = self.root / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as package:
            package.writestr('../escape', 'never extracted')
        metadata = {'id': 42, 'name': 'runtime-' + self.sha, 'expired': False,
                    'workflow_run': {'id': 123, 'head_sha': self.sha},
                    'digest': 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()}
        with self.assertRaises(ValueError):
            self.module.unpack(self.root / 'rejected', archive, metadata, self.sha, 123, 1)
        self.assertFalse((self.root / 'escape').exists())

    def test_retag_or_wrong_revision_or_platform_does_not_promote_a_different_image(self):
        manifest = self.produce()
        for patch in ({'Id': 'sha256:' + 'd' * 64}, {'Architecture': 'arm64'},
                      {'Config': {'Labels': {'org.opencontainers.image.revision': 'd' * 40}}}):
            with self.assertRaises(ValueError):
                self.module.verify_loaded(manifest, [{**self.images[0], **patch}, self.images[1]])


class RuntimeArtifactWorkflowTests(unittest.TestCase):
    def test_source_ci_publishes_images_and_promotion_never_rebuilds_them(self):
        ci = (ROOT / '.github/workflows/ci.yml').read_text().split('  server-image:', 1)[1].split('  lint-biome:', 1)[0]
        self.assertIn('actions/upload-artifact@v4', ci)
        self.assertIn('runtime_artifact.py create', ci)
        self.assertIn('runtime_artifact.py fetch', ci)
        self.assertEqual(ci.count("if: steps.runtime_artifact.outputs.reused != 'true'"), 4)
        self.assertIn('compression-level: 0', ci)
        release = (ROOT / '.github/workflows/vps-cache-cleanup.yml').read_text().split('  controlled-candidate-release:', 1)[1]
        self.assertIn('Load exact CI runtime artifact', release)
        self.assertIn('runtime_artifact.py verify', release)
        self.assertIn('runtime_artifact.py loaded', release)
        self.assertIn('Seal the actual installed runtime passport', release)
        self.assertIn('runtime_passport.py --artifact', release)
        self.assertNotIn('-f deploy/Dockerfile.server', release)
        self.assertNotIn('-f deploy/Dockerfile.web', release)
        self.assertIn('source_ci_gate.py', release)
        self.assertIn('Freeze writers once', release)
        self.assertIn('Independent one-clone candidate and previous runtime', release)


if __name__ == '__main__':
    unittest.main()
