function verify(event, results) {
  const imageExpected = ['pull_request', 'workflow_dispatch', 'merge_group'].includes(event);
  if (!imageExpected && event !== 'push') throw new Error('Unknown CI trigger');
  for (const job of ['backend', 'frontend', 'change-detection']) {
    if (results[job] !== 'success')
      throw new Error(`${job}: expected success, got ${results[job]}`);
  }
  const expected = imageExpected ? 'success' : 'skipped';
  if (results['build-staging-images'] !== expected) {
    throw new Error(
      `build-staging-images: expected ${expected}, got ${results['build-staging-images']}`,
    );
  }
}

if (require.main === module) {
  try {
    verify(process.env.GITHUB_EVENT_NAME, {
      backend: process.env.BACKEND,
      frontend: process.env.FRONTEND,
      'change-detection': process.env.SCOPE,
      'build-staging-images': process.env.IMAGES,
    });
    console.log('All required CI jobs completed successfully.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verify };
