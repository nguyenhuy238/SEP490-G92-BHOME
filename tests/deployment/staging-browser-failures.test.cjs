const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailures } = require('../../scripts/Test-StagingBrowser.cjs');

const failure = {
  method: 'GET',
  origin: 'https://api.example.invalid',
  path: '/api/v1/rooms',
  error: 'net::ERR_ABORTED',
  navigation: false,
};
test('unexplained browser aborts remain failures', () => {
  assert.deepEqual(classifyFailures([failure]).unexpected, [failure]);
});
test('only explicit test navigation can explain a cancellation', () => {
  const classified = classifyFailures([{ ...failure, navigation: true }, failure]);
  assert.equal(classified.expected.length, 1);
  assert.equal(classified.unexpected.length, 1);
});
test('network failures cannot be hidden by navigation', () => {
  const transport = { ...failure, error: 'net::ERR_CONNECTION_RESET', navigation: true };
  assert.deepEqual(classifyFailures([transport]).unexpected, [transport]);
});
