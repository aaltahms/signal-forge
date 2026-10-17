import csv
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
class CliTests(unittest.TestCase):
    def test_producer_through_real_capture_process(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'capture.csv'
            producer=subprocess.Popen([sys.executable,'-B','examples/producer.py','--count','4','--interval-ms','2'],cwd=ROOT,stdout=subprocess.PIPE)
            result=subprocess.run([sys.executable,'-B','-m','collector.capture','--output',str(output),'--count','4'],cwd=ROOT,stdin=producer.stdout,capture_output=True,timeout=10)
            producer.stdout.close();producer.wait(timeout=10)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            data=list(csv.DictReader(io.StringIO(output.read_text())))
            self.assertEqual([int(r['sequence']) for r in data],[0,1,2,3])
            self.assertEqual([r['boot_id'] for r in data],['simulated-1']*4)
            self.assertEqual(float(data[0]['received_ms']),0)
            self.assertGreaterEqual(float(data[-1]['received_ms']),float(data[0]['received_ms']))

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'keep.csv';output.write_text('keep this file')
            result=subprocess.run([sys.executable,'-B','-m','collector.capture','--output',str(output)],cwd=ROOT,input=b'',capture_output=True,timeout=10)
            self.assertEqual(result.returncode,2);self.assertEqual(output.read_text(),'keep this file')

    def test_invalid_only_input_does_not_report_a_successful_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'capture.csv'
            result=subprocess.run([sys.executable,'-B','-m','collector.capture','--output',str(output)],cwd=ROOT,input=b'bad\n',capture_output=True,timeout=10)
            self.assertEqual(result.returncode,1);self.assertIn(b'0 accepted, 1 skipped',result.stderr)

if __name__=='__main__':unittest.main()
