import csv
import io
import os
import json
import unittest
from collector.capture import capture,decode_packet,SerialLines

class CaptureTests(unittest.TestCase):
    def test_capture_preserves_sequence_and_stamps_actual_arrival_clock(self):
        source=io.BytesIO(b'{"sequence":0,"value":22}\n{"sequence":2,"value":23}\n')
        target=io.StringIO();clock=iter([1_000_000_000,1_150_000_000])
        result=capture(source,target,clock=lambda:next(clock))
        data=list(csv.DictReader(io.StringIO(target.getvalue())))
        self.assertEqual(result,{'accepted':2,'rejected':0})
        self.assertEqual([r['received_ms'] for r in data],['0.0','150.0'])
        self.assertEqual([r['sequence'] for r in data],['0','2'])

    def test_bad_packets_are_skipped_and_diagnostics_retained(self):
        source=io.BytesIO(b'bad\n{"sequence":1,"value":true}\n{"sequence":2,"value":2}\n')
        target=io.StringIO();errors=io.StringIO()
        result=capture(source,target,diagnostics=errors)
        self.assertEqual(result,{'accepted':1,'rejected':2});self.assertIn('Skipped packet',errors.getvalue())

    def test_overlong_packet_does_not_become_two_fake_readings(self):
        source=io.BytesIO(b'x'*10000+b'\n{"sequence":1,"value":1}\n')
        self.assertEqual(capture(source,io.StringIO(),diagnostics=io.StringIO()),{'accepted':1,'rejected':1})

    def test_packet_types_bounds_and_deep_json(self):
        for packet in [b'[]',b'{"sequence":true,"value":1}',b'{"sequence":-1,"value":1}',b'{"sequence":0,"value":1e999}',
                       b'{"sequence":0,"value":1,"boot_id":"bad id"}',('{"sequence":0,"value":'+('9'*500)+'}').encode(),b'['*2000+b']'*2000]:
            with self.subTest(packet=packet[:50]),self.assertRaises(ValueError):decode_packet(packet)

    def test_count_and_boot_boundaries(self):
        packets=[{'sequence':0,'value':1,'boot_id':boot} for boot in ['a','b','a']]
        source=io.BytesIO(('\n'.join(json.dumps(p) for p in packets)+'\n').encode())
        self.assertEqual(capture(source,io.StringIO(),diagnostics=io.StringIO()),{'accepted':2,'rejected':1})
        with self.assertRaises(ValueError):capture(io.BytesIO(),io.StringIO(),count=0)
        source=io.BytesIO(b'{"sequence":1,"value":1}\n{"sequence":2,"value":2}\n')
        self.assertEqual(capture(source,io.StringIO(),count=1)['accepted'],1)

    @unittest.skipUnless(os.name=='posix','POSIX serial adapter')
    def test_virtual_serial_frames_are_captured_and_tty_state_restored(self):
        import termios
        master,slave=os.openpty();before=termios.tcgetattr(slave);serial=SerialLines(os.ttyname(slave),115200,1)
        try:
            os.write(master,b'{"sequence":0,"value":21}\n{"sequence":1,"value":22}\n')
            target=io.StringIO();result=capture(serial,target,count=2)
            self.assertEqual(result['accepted'],2);self.assertEqual(len(list(csv.DictReader(io.StringIO(target.getvalue())))),2)
        finally:
            serial.close()
            after=termios.tcgetattr(slave)
            # macOS may set PENDIN (kernel pending-input state) when canonical mode resumes.
            after[3] &= ~getattr(termios,'PENDIN',0)
            before[3] &= ~getattr(termios,'PENDIN',0)
            try:self.assertEqual(after,before)
            finally:os.close(master);os.close(slave)

    @unittest.skipUnless(os.name=='posix','POSIX serial adapter')
    def test_virtual_serial_idle_timeout_is_actionable(self):
        master,slave=os.openpty();serial=SerialLines(os.ttyname(slave),115200,.02)
        try:
            with self.assertRaises(TimeoutError):serial.readline(4097)
        finally:serial.close();os.close(master);os.close(slave)

if __name__=='__main__':unittest.main()
