"""Package only SignalForge source, docs and redistributable examples."""
import hashlib
import json
from pathlib import Path
import zipfile
ROOT=Path(__file__).resolve().parent
VERSION='0.1.0'
FILES=['README.md','LICENSE','.gitignore','package.json','release.py']
DIRECTORIES=['web','collector','tests','docs','examples','.github']

def main():
    paths=[ROOT/name for name in FILES]
    for name in DIRECTORIES:
        paths.extend(p for p in (ROOT/name).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc' and p.name!='.DS_Store')
    paths=sorted(set(paths));manifest={'version':VERSION,'sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    destination=ROOT/'dist';destination.mkdir(exist_ok=True)
    archive=destination/f'signal-forge-{VERSION}.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as output:
        for path in paths:output.write(path,'signal-forge/'+str(path.relative_to(ROOT)))
        output.writestr('signal-forge/RELEASE-MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
    checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(checksum+'  '+archive.name+'\n')
    print(f'{archive}\n{len(paths)} scoped files\nSHA-256 {checksum}')

if __name__=='__main__':main()
