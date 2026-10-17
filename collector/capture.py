"""Capture newline-delimited JSON readings from stdin or a POSIX serial device."""
import argparse
import csv
import io
import json
import math
import os
from pathlib import Path
import re
import select
import sys
import time

MAX_ROWS = 20000
MAX_LINE = 4096

def decode_packet(raw):
    if len(raw) > MAX_LINE:
        raise ValueError('packet exceeds 4096 bytes')
    try:
        data = json.loads(raw)
    except (UnicodeError, ValueError, RecursionError):
        raise ValueError('packet is not UTF-8 JSON')
    if not isinstance(data, dict):
        raise ValueError('expected a JSON object')
    sequence = data.get('sequence')
    value = data.get('value')
    boot = data.get('boot_id', 'capture')
    if type(sequence) is not int or not 0 <= sequence <= 0xffffffff:
        raise ValueError('sequence must be uint32')
    if type(value) not in (int, float) or abs(value) > 1e12 or not math.isfinite(value):
        raise ValueError('value must be finite, from -1e12 to 1e12')
    if not isinstance(boot, str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,64}', boot):
        raise ValueError('invalid boot_id')
    return {'sequence':sequence,'value':value,'boot_id':boot}


def capture(stream, output, count=MAX_ROWS, clock=time.monotonic_ns, diagnostics=sys.stderr):
    if not 1 <= count <= MAX_ROWS:
        raise ValueError('count must be from 1 to 20000')
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(['received_ms','sequence','value','boot_id'])
    accepted = rejected = 0
    first_time = None
    current_boot = None
    finished_boots = set()
    while accepted < count:
        raw = stream.readline(MAX_LINE + 1)
        if not raw:
            break
        if not raw.endswith(b'\n') and len(raw) > MAX_LINE:
            # Consume the rest of an overlong frame; never reinterpret its tail as a new packet.
            while raw and not raw.endswith(b'\n'):
                raw = stream.readline(MAX_LINE + 1)
            rejected += 1
            print('Skipped overlong packet.', file=diagnostics)
            continue
        if not raw.strip():
            continue
        arrived = clock()
        try:
            row = decode_packet(raw)
            if row['boot_id'] != current_boot:
                if row['boot_id'] in finished_boots:
                    raise ValueError('boot_id reused after another boot; use a new boot ID')
                if current_boot is not None:
                    finished_boots.add(current_boot)
                current_boot = row['boot_id']
        except ValueError as error:
            rejected += 1
            print('Skipped packet: %s.' % error, file=diagnostics)
            continue
        if first_time is None:
            first_time = arrived
        elapsed = round((arrived-first_time)/1_000_000, 6)
        writer.writerow([elapsed,row['sequence'],row['value'],row['boot_id']])
        output.flush()
        accepted += 1
    return {'accepted':accepted,'rejected':rejected}


class SerialLines:
    """Bounded serial framing, with an explicit idle timeout and restored tty settings."""
    def __init__(self, path, baud, idle_seconds):
        import termios
        import tty
        if not hasattr(termios, 'B%s' % baud):
            raise ValueError('Unsupported baud rate on this host.')
        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self.previous = None
        self.timeout = idle_seconds
        self.pending = bytearray()
        self.termios = termios
        try:
            self.previous = termios.tcgetattr(self.fd)
            tty.setraw(self.fd)
            config = termios.tcgetattr(self.fd)
            config[4] = config[5] = getattr(termios, 'B%s' % baud)
            termios.tcsetattr(self.fd, termios.TCSANOW, config)
        except BaseException:
            self.close()
            raise

    def readline(self, limit):
        deadline = time.monotonic() + self.timeout
        while True:
            newline = self.pending.find(b'\n')
            if newline >= 0 or len(self.pending) >= limit:
                stop = min(newline+1 if newline>=0 else len(self.pending),limit)
                result = bytes(self.pending[:stop]); del self.pending[:stop]
                return result
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if self.pending:
                    raise TimeoutError('Serial input stopped inside an unfinished packet.')
                raise TimeoutError('No serial data arrived before the idle timeout.')
            ready, _, _ = select.select([self.fd], [], [], remaining)
            if ready:
                data = os.read(self.fd, MAX_LINE + 1)
                if not data:
                    if self.pending:
                        raise ValueError('Serial device disconnected inside an unfinished packet.')
                    return b''
                self.pending.extend(data)

    def close(self):
        try:
            if self.previous is not None:
                self.termios.tcsetattr(self.fd,self.termios.TCSANOW,self.previous)
        finally:
            os.close(self.fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New CSV file; existing files are not overwritten')
    parser.add_argument('--device', help='Optional local serial device; otherwise read stdin')
    parser.add_argument('--baud', type=int, default=115200)
    parser.add_argument('--count', type=int, default=MAX_ROWS)
    parser.add_argument('--idle-seconds', type=float, default=10)
    args = parser.parse_args()
    source = None
    try:
        if not 1 <= args.count <= MAX_ROWS:
            raise ValueError('count must be from 1 to 20000')
        if not math.isfinite(args.idle_seconds) or not 0 < args.idle_seconds <= 3600:
            raise ValueError('idle-seconds must be from 0 to 3600, exclusive of 0')
        if args.device:
            if os.name != 'posix':
                raise ValueError('Direct serial capture supports macOS/Linux. Use stdin on other platforms.')
            source = SerialLines(args.device,args.baud,args.idle_seconds)
        with args.output.open('x', newline='') as output:
            try:
                result = capture(source or sys.stdin.buffer,output,args.count)
            except KeyboardInterrupt:
                print('Capture stopped; complete readings remain in %s.' % args.output, file=sys.stderr)
                raise SystemExit(130)
        print('%s accepted, %s skipped. Open %s in SignalForge.' % (result['accepted'],result['rejected'],args.output), file=sys.stderr)
        if not result['accepted']:
            raise SystemExit(1)
    except (OSError, ValueError, TimeoutError) as error:
        print('Capture stopped: %s. Any complete readings already written remain in the output file.' % error,file=sys.stderr)
        raise SystemExit(2)
    finally:
        if source:
            source.close()

if __name__ == '__main__':
    main()
