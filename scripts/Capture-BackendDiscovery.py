"""Discover the current CI assemblies before execution; never rewrite the baseline."""
import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def capture(output, dotnet):
    output.mkdir(parents=True, exist_ok=False)
    solution = ROOT / 'src/backend/BHome.CI.slnf'
    projects = json.loads(solution.read_text(encoding='utf-8'))['solution']['projects']
    discovered = {}
    for relative in projects:
        project = (solution.parent / relative.replace('\\', '/')).resolve()
        result = subprocess.run([
            dotnet, 'test', str(project), '-c', 'Release', '--no-build',
            '--settings', str(ROOT / 'tests/backend/ci.runsettings'), '--list-tests',
        ], cwd=ROOT, env=dict(os.environ, DOTNET_CLI_UI_LANGUAGE='en-US'),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', check=True)
        (output / (project.stem + '.log')).write_text(result.stdout, encoding='utf-8')
        header = 'The following Tests are available:'
        if header not in result.stdout or project.stem in discovered:
            raise ValueError('Missing or duplicate test discovery: ' + project.stem)
        names = [line.strip() for line in result.stdout.split(header, 1)[1].splitlines()
                 if line.startswith('    ' + project.stem + '.')]
        if not names:
            raise ValueError('Empty test discovery: ' + project.stem)
        discovered[project.stem] = names
    (output / 'discovery.json').write_text(json.dumps(discovered, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--dotnet', default='dotnet')
    args = parser.parse_args()
    capture(args.output.resolve(), args.dotnet)
