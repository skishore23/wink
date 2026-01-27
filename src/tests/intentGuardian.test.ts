import { describe, it, expect } from 'vitest';
import { isSubstantialTask } from '../core/intentDetector';

describe('Intent Detector', () => {
  describe('returns false for', () => {
    it('short prompts', () => {
      expect(isSubstantialTask('fix it')).toBe(false);
      expect(isSubstantialTask('do that')).toBe(false);
      expect(isSubstantialTask('yes please')).toBe(false);
    });

    it('commands', () => {
      expect(isSubstantialTask('/wink')).toBe(false);
      expect(isSubstantialTask('/verify')).toBe(false);
      expect(isSubstantialTask('/status')).toBe(false);
      expect(isSubstantialTask('/help')).toBe(false);
    });

    it('acknowledgments', () => {
      expect(isSubstantialTask('ok')).toBe(false);
      expect(isSubstantialTask('yes')).toBe(false);
      expect(isSubstantialTask('sounds good')).toBe(false);
      expect(isSubstantialTask('thanks')).toBe(false);
      expect(isSubstantialTask('go ahead')).toBe(false);
      expect(isSubstantialTask('perfect')).toBe(false);
      expect(isSubstantialTask('great job')).toBe(false);
    });

    it('pure questions without action intent', () => {
      expect(isSubstantialTask('what is this file?')).toBe(false);
      expect(isSubstantialTask('how does the auth system work?')).toBe(false);
      expect(isSubstantialTask('can you explain the architecture?')).toBe(false);
      expect(isSubstantialTask('where is the config?')).toBe(false);
    });

    it('follow-ups and modifications', () => {
      expect(isSubstantialTask('also add tests')).toBe(false);
      expect(isSubstantialTask('actually nevermind')).toBe(false);
      expect(isSubstantialTask('wait, cancel that')).toBe(false);
      expect(isSubstantialTask('ignore that last request')).toBe(false);
    });

    it('very short phrases', () => {
      expect(isSubstantialTask('do it')).toBe(false);
      expect(isSubstantialTask('run it')).toBe(false);
      expect(isSubstantialTask('fix bug')).toBe(false);
    });
  });

  describe('returns true for', () => {
    it('explicit task requests with verbs', () => {
      expect(isSubstantialTask('Create a new authentication module using JWT')).toBe(true);
      expect(isSubstantialTask('Refactor the database layer to use connection pooling')).toBe(true);
      expect(isSubstantialTask('Add error handling to all API endpoints')).toBe(true);
      expect(isSubstantialTask('Write tests for the user service')).toBe(true);
    });

    it('multi-part requests', () => {
      expect(isSubstantialTask('Refactor auth to use JWT, add rate limiting, and update the docs')).toBe(true);
    });

    it('long detailed requests', () => {
      const longPrompt = 'I need you to look at the authentication system and make sure it properly validates tokens, handles expired sessions gracefully, and logs all auth failures for security monitoring';
      expect(isSubstantialTask(longPrompt)).toBe(true);
    });

    it('questions with action intent', () => {
      expect(isSubstantialTask('Can you create a new config file for the database settings?')).toBe(true);
      expect(isSubstantialTask('Could you refactor this to use async/await instead of callbacks?')).toBe(true);
    });

    it('implementation requests', () => {
      expect(isSubstantialTask('Implement a caching layer for the API responses')).toBe(true);
      expect(isSubstantialTask('Build a webhook handler for Stripe payments')).toBe(true);
      expect(isSubstantialTask('Setup the testing infrastructure with vitest')).toBe(true);
    });

    it('fix and update requests', () => {
      expect(isSubstantialTask('Fix the login bug where users get logged out randomly')).toBe(true);
      expect(isSubstantialTask('Update the payment processing to handle refunds')).toBe(true);
    });
  });
});
