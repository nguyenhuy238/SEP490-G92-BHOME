const fs = require('node:fs');

function validate(environment, branches) {
  if (
    !environment.protection_rules?.some(
      (rule) => rule.type === 'required_reviewers' && rule.reviewers?.length,
    )
  )
    throw new Error('Production must have required reviewers before CD can run.');
  if (environment.can_admins_bypass !== false)
    throw new Error('Disable administrator bypass for the Production approval gate.');
  if (
    !environment.deployment_branch_policy?.custom_branch_policies ||
    environment.deployment_branch_policy.protected_branches
  )
    throw new Error('Production requires an explicit main-only deployment branch policy.');
  if (
    branches.total_count !== 1 ||
    branches.branch_policies?.length !== 1 ||
    branches.branch_policies[0].name !== 'main' ||
    branches.branch_policies[0].type !== 'branch'
  )
    throw new Error('Only the main branch may deploy Production.');
}
async function main() {
  const base = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/environments/production`;
  const values = [];
  for (const suffix of ['', '/deployment-branch-policies']) {
    const result = await fetch(base + suffix, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!result.ok)
      throw new Error(`Cannot verify Production environment protection: HTTP ${result.status}`);
    values.push(await result.json());
  }
  validate(...values);
  fs.writeFileSync(
    'production-gate.json',
    JSON.stringify(
      { checkedAt: new Date().toISOString(), environment: values[0], branches: values[1] },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Production reviewers, no admin bypass, and main-only policy. GitHub must still approve the deployment job.',
  );
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validate };
