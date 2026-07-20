import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsAcknowledgement } from '../server/services/googlePlay.js';

test('needsAcknowledgement: ACKNOWLEDGEMENT_STATE_PENDING → true', () => {
  assert.equal(needsAcknowledgement('ACKNOWLEDGEMENT_STATE_PENDING'), true);
});

test('needsAcknowledgement: ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED → false', () => {
  assert.equal(needsAcknowledgement('ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'), false);
});

test('needsAcknowledgement: null → false', () => {
  assert.equal(needsAcknowledgement(null), false);
});

test('needsAcknowledgement: undefined → false', () => {
  assert.equal(needsAcknowledgement(undefined), false);
});

test('needsAcknowledgement: 未知の値（想定外の文字列）→ false', () => {
  assert.equal(needsAcknowledgement('SOMETHING_UNEXPECTED'), false);
});
