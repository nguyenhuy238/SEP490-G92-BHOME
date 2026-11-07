"""Acquire the pinned official Apache-2.0 Grounding DINO research candidate.

Public model files only; no images, credentials, remote code or app activation.
Use the file SHA receipt already reviewed with the model metadata, not latest.
"""
import argparse
import hashlib
import json
from pathlib import Path
import requests

REVISION='a2bb814dd30d776dcf7e30523b00659f4f141c71'
WEIGHTS_SHA='1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3'


def prepare(root,receipt):
    metadata=json.loads(receipt.read_text())
    if metadata['revision']!=REVISION or metadata['repository']!='IDEA-Research/grounding-dino-tiny' or metadata['license']!='Apache-2.0':
        raise ValueError('Unreviewed official model receipt')
    if metadata['files']['model.safetensors']['sha256']!=WEIGHTS_SHA:raise ValueError('Unpinned weights')
    root.mkdir(parents=True,exist_ok=True)
    for name,entry in metadata['files'].items():
        if Path(name).name!=name or name not in {'README.md','config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json','vocab.txt','model.safetensors'}:
            raise ValueError('Unsafe model artifact name')
        target=root/name
        if not target.exists():
            with requests.get(f'https://huggingface.co/IDEA-Research/grounding-dino-tiny/resolve/{REVISION}/{name}',stream=True,timeout=(30,180)) as response:
                response.raise_for_status();parts=[];size=0
                for chunk in response.iter_content(1024*1024):
                    size+=len(chunk)
                    if size>min(entry['bytes'],700_000_000):raise ValueError('Artifact download bound exceeded')
                    parts.append(chunk)
            data=b''.join(parts)
            if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Official artifact checksum mismatch')
            target.write_bytes(data)
        if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Existing artifact checksum mismatch')
    (root/'provenance.json').write_text(json.dumps(metadata,indent=2)+'\n')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path);p.add_argument('receipt',type=Path)
    a=p.parse_args();prepare(a.directory,a.receipt);print('Pinned public detector artifacts verified; runtime remains unchanged.')
