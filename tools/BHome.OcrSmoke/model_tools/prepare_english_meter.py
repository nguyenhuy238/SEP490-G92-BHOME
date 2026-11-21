"""Pinned official Apache-2.0 Paddle model for offline water-reader experiments."""
import argparse
import hashlib
import json
from pathlib import Path
import requests
import yaml

REVISION='3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b'
FILES={'inference.onnx':'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
       'inference.yml':'27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067',
       'README.md':'98b45ea81164d1e1a1dd82255207053b15cd6c69d922a1c5cf3387ce604d4b74'}
DICTIONARY_SHA='3a3e5abea6e7d403209043c8d67b052414ae59ece49922cc7e3ac205d59060a8'


def prepare(root):
    root.mkdir(parents=True,exist_ok=True)
    for name,expected in FILES.items():
        path=root/name
        if not path.exists():
            response=requests.get(f'https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/{REVISION}/{name}',timeout=90)
            response.raise_for_status()
            if len(response.content)>9_000_000 or hashlib.sha256(response.content).hexdigest()!=expected:
                raise ValueError('Official meter model checksum/size mismatch')
            path.write_bytes(response.content)
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('Existing model checksum mismatch')
    config=yaml.safe_load((root/'inference.yml').read_text(encoding='utf-8'))
    content=json.dumps(['',*config['PostProcess']['character_dict'],' '],ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if hashlib.sha256(content).hexdigest()!=DICTIONARY_SHA:raise ValueError('Model dictionary mismatch')
    (root/'charset.json').write_bytes(content)
    (root/'provenance.json').write_text(json.dumps({'repository':'PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx','revision':REVISION,
        'license':'Apache-2.0','sourceUrl':'https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx',
        'files':FILES,'dictionarySha256':DICTIONARY_SHA,'applicationActivation':False},indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory',type=Path);args=p.parse_args();prepare(args.directory)
    print('Pinned English model/config/dictionary verified; application remains unchanged.')
