# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
from __future__ import annotations

import fcntl
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys


def run_locked(lock: Path, command: list[str]) -> int:
    # Never unlink: every process must lock the same inode.
    fd = os.open(lock.with_name(f"{lock.name}.flock"), os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise PermissionError("not a regular Docker lock file owned by this user")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("verify: waiting for another Docker-backed run", flush=True)
            fcntl.flock(fd, fcntl.LOCK_EX)
        # Group signals still reach the child; retain ownership through its cleanup.
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: None)
        code = subprocess.call(command, pass_fds=(fd,))
        return code if code >= 0 else 128 - code
    finally:
        os.close(fd)


if __name__ == "__main__":
    sys.exit(run_locked(Path(sys.argv[1]), sys.argv[2:]))
