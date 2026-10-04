import { describe, expect, it } from 'vitest';

import { browserName, describeInstall, platformName } from './names';

describe('connected browser names', () => {
  it('names known browsers and platforms', () => {
    expect(browserName('edge')).toBe('Microsoft Edge');
    expect(browserName('chromium')).toBe('Chromium');
    expect(platformName('mac')).toBe('macOS');
    expect(platformName('cros')).toBe('ChromeOS');
    expect(describeInstall({ browser: 'chrome', platform: 'mac' })).toBe(
      'Chrome on macOS',
    );
  });

  it('title-cases anything unknown, and leaves out a missing platform', () => {
    expect(browserName('vivaldi')).toBe('Vivaldi');
    expect(browserName('arc_browser')).toBe('Arc Browser');
    expect(platformName('openbsd')).toBe('Openbsd');
    expect(browserName('')).toBe('Browser');
    expect(describeInstall({ browser: 'brave', platform: '' })).toBe('Brave');
  });
});
