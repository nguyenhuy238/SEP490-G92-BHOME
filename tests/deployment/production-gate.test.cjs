const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../../scripts/Verify-ProductionGate.cjs');
const environment = {
  can_admins_bypass: false,
  protection_rules: [
    {
      type: 'required_reviewers',
      reviewers: [{ type: 'User', reviewer: { login: 'synthetic-reviewer' } }],
    },
  ],
  deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
};
const branches = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
test('accepts reviewer-protected main-only production', () => {
  validate(environment, branches);
});
test('rejects an environment that merely exists without reviewers', () => {
  assert.throws(() => validate({ ...environment, protection_rules: [] }, branches), /reviewers/);
});
test('rejects administrator approval bypass', () => {
  assert.throws(() => validate({ ...environment, can_admins_bypass: true }, branches), /bypass/);
});
test('rejects develop, wildcard and tag deployment policies', () => {
  for (const policy of [
    { name: 'develop', type: 'branch' },
    { name: '*', type: 'branch' },
    { name: 'main', type: 'tag' },
  ])
    assert.throws(
      () => validate(environment, { total_count: 1, branch_policies: [policy] }),
      /main/,
    );
});
