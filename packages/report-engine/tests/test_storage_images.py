"""Only old, singly tagged project images may leave the rollback inventory."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path


def test_image_retention_protects_runtime_rollback_recent_and_foreign_images():
    path = Path(__file__).resolve().parents[3] / 'deploy/storage-images.py'
    spec = importlib.util.spec_from_file_location('storage_images', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    def image(identifier, tags, created='2026-10-01T00:00:00Z'):
        return {'Id': identifier, 'RepoTags': tags, 'Created': created}
    old = image('old', ['aemr-server:old'])
    images = [old, image('runtime', ['aemr-server:live']),
              image('rollback', ['aemr-web:previous']),
              image('maintenance', ['aemr-server:maintenance']),
              image('recent', ['aemr-server:candidate'], '2026-10-18T00:00:00Z'),
              image('foreign', ['another-service:old']), image('dangling', []),
              image('aliases', ['aemr-server:old', 'aemr-server:latest'])]
    selected = module.plan_images(images, {'runtime', 'rollback', 'maintenance'},
                                  datetime(2026, 10, 19, tzinfo=timezone.utc))
    assert selected == [old]
