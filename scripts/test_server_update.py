from __future__ import annotations

import importlib
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch


class ServerUpdateTest(unittest.TestCase):
    def test_remote_command_failure_raises(self) -> None:
        with patch("paramiko.SSHClient"):
            module = importlib.import_module("scripts.server_update")

        stdout = Mock()
        stdout.read.return_value = b"partial output"
        stdout.channel.recv_exit_status.return_value = 23
        stderr = Mock()
        stderr.read.return_value = b"remote failure"
        client = Mock()
        client.exec_command.return_value = (Mock(), stdout, stderr)

        with redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, r"exit 23"):
                module.run_remote(client, "false", timeout=10)

        client.exec_command.assert_called_once_with(
            "false",
            timeout=10,
            get_pty=True,
        )


if __name__ == "__main__":
    unittest.main()
