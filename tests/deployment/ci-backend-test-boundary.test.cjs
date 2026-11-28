const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const slnf = JSON.parse(fs.readFileSync(path.join(root, 'src/backend/BHome.CI.slnf'), 'utf8'));

test('backend CI uses a solution filter without externally targeted plan integration tests', () => {
  const selected = slnf.solution.projects.map((project) => project.replaceAll('\\', '/'));
  assert.equal(slnf.solution.path, 'BHome.sln');
  assert.equal(new Set(selected).size, selected.length);
  assert.ok(fs.existsSync(path.join(root, 'src/backend/BHome.Api/BHome.Api.csproj')));
  assert.ok(
    !selected.some((project) =>
      /(?:^|\/)BHome\.(?:Domain|Application|Infrastructure)\.csproj$/.test(project),
    ),
  );
  for (const project of selected) {
    assert.ok(fs.existsSync(path.resolve(root, 'src/backend', project)), `Missing ${project}`);
  }
  for (const suite of [
    'BHome.Application.UnitTests',
    'BHome.Domain.UnitTests',
    'BHome.Infrastructure.UnitTests',
    'BHome.IntegrationTests',
    'BHome.DigitalSigning.UnitTests',
  ]) {
    assert.ok(
      selected.some((project) => project.endsWith(`/${suite}/${suite}.csproj`)),
      suite,
    );
  }
  assert.ok(!selected.some((project) => project.includes('BHome.PlanIntegrationTests')));
  assert.match(ci, /dotnet test src\/backend\/BHome\.CI\.slnf /);
  assert.doesNotMatch(ci, /dotnet test src\/backend\/BHome\.sln /);
});
