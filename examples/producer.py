"""A clearly simulated NDJSON producer for collector verification, not hardware data."""
import argparse
import json
import math
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--count',type=int,default=30)
parser.add_argument('--interval-ms',type=float,default=100)
args = parser.parse_args()
if not 1 <= args.count <= 20000 or not 0 < args.interval_ms <= 3600000:
    parser.error('Use 1..20000 samples and a positive interval up to 3600000 ms.')
for sequence in range(args.count):
    print(json.dumps({'sequence':sequence,'value':round(22+math.sin(sequence/11),4),'boot_id':'simulated-1'}),flush=True)
    if sequence < args.count-1:
        time.sleep(args.interval_ms/1000)
