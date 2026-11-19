# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
# Usage: python3 -I -B verify/docker-lock.py LOCK COMMAND [ARGS...]
from __future__ import annotations

import fcntl
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


def run_locked(lock: Path, command: list[str]) -> int:
    # Never unlink the flock file: all contenders must lock the same inode.
    kernel_lock = lock.with_name(f"{lock.name}.flock")
    fd = os.open(kernel_lock, os.O_CREAT | os.O_NOFOLLOW | os.O_RDWR, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise PermissionError("not a regular Docker lock file owned by this user")

        waiting = False

        def announce() -> None:
            nonlocal waiting
            if not waiting:
                print("verify: waiting for another Docker-backed run", flush=True)
                waiting = True

        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            announce()
            fcntl.flock(fd, fcntl.LOCK_EX)

        # Under flock, only this process can remove our atomic marker. A plain
        # mkdir owner cannot create a directory until that marker is absent.
        if lock.is_symlink() and os.readlink(lock) == kernel_lock.name:
            lock.unlink()
        while True:
            try:
                lock.symlink_to(kernel_lock.name)
                break
            except FileExistsError:
                announce()
                time.sleep(0.25)

        try:
            # The verifier signals the whole process group. Keep the supervisor
            # alive until the integration shell has finished its EXIT cleanup.
            for sig in (signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, lambda *_: None)
            # Ownership crosses fork with the open file description, not a PID
            # published after spawn. A killed supervisor cannot free a live child.
            code = subprocess.call(command, pass_fds=(fd,))
            return code if code >= 0 else 128 - code
        finally:
            lock.unlink()
    finally:
        os.close(fd)


if __name__ == "__main__":
    sys.exit(run_locked(Path(sys.argv[1]), sys.argv[2:]))
