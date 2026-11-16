#!/usr/bin/env python3
# The admin terminal's process (hub/admin.mjs): runs ssh in a pseudo-terminal so full-screen programs, colours and resizing
# work. stdin/stdout carry the terminal's bytes; fd 3 carries "rows cols" lines when the browser's terminal is resized.
#   term-pty.py <key> <known_hosts> <user@host> <rows> <cols>
import fcntl, os, pty, select, signal, struct, sys, termios

key, known, target, rows, cols = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
pid, fd = pty.fork()
if pid == 0:
    os.execvp('ssh', ['ssh', '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', f'UserKnownHostsFile={known}',
                      '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', target])

def resize(r, c):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    os.kill(pid, signal.SIGWINCH)

resize(rows, cols)
ctl, buf = 3, b''
try: os.fstat(ctl); watch = [0, fd, ctl]
except OSError: watch = [0, fd]   # no resize channel
try:
    while True:
        r, _, _ = select.select(watch, [], [])
        if fd in r:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            os.write(1, data)
        if 0 in r:
            data = os.read(0, 65536)
            if not data: break
            os.write(fd, data)
        if ctl in r:
            data = os.read(ctl, 4096)
            if not data: watch.remove(ctl); continue
            buf += data
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                try: rr, cc = map(int, line.split()); resize(rr, cc)
                except ValueError: pass
finally:
    try: os.kill(pid, signal.SIGHUP)
    except ProcessLookupError: pass
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0)
