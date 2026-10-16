// C8 contract (D64): mobile/app.config.js takes app.json's config and, only when
// APP_VARIANT=development, renames the app and moves it to the .dev package so a standalone
// build installs beside the dev client. eas.json wires the variant into the development
// profile and bakes the deployed API URL into a preview APK.

//
// B34 contract (D67-D69): over-the-air updates. app.json carries the fingerprint runtime
// policy and the EAS Update URL for both variants, eas.json gives preview and development
// their channels, and deploy.sh ships the phone update after the backend is live.

import { readFileSync } from 'fs';
import { join } from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const appJson = require('../../app.json');
const easJson = require('../../eas.json');

type ExpoConfig = typeof appJson.expo;

function loadConfig(variant: string | undefined): ExpoConfig {
  if (variant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = variant;
  }
  let result: ExpoConfig;
  jest.isolateModules(() => {
    const mod = require('../../app.config.js');
    const fn = mod.default ?? mod;
    result = fn({ config: JSON.parse(JSON.stringify(appJson.expo)) });
  });
  return result!;
}

const originalVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (originalVariant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = originalVariant;
  }
});

describe('app.config.js', () => {
  it('uses the dev name and package when APP_VARIANT=development', () => {
    const config = loadConfig('development');
    expect(config.name).toBe('Stopwatch Scheduler (Dev)');
    expect(config.android.package).toBe('app.workflow.stopwatch.dev');
    expect(config.android.permissions).toEqual(appJson.expo.android.permissions);
    expect(config.slug).toBe(appJson.expo.slug);
  });

  it("returns app.json's config unchanged without APP_VARIANT", () => {
    const config = loadConfig(undefined);
    expect(config.name).toBe(appJson.expo.name);
    expect(config.android.package).toBe(appJson.expo.android.package);
    expect(config).toEqual(appJson.expo);
  });

  it('ignores any other APP_VARIANT value', () => {
    const config = loadConfig('preview');
    expect(config).toEqual(appJson.expo);
  });
});

describe('eas.json', () => {
  it('development profile sets APP_VARIANT=development', () => {
    expect(easJson.build.development.env).toEqual(
      expect.objectContaining({ APP_VARIANT: 'development' })
    );
  });

  it('preview profile bakes the deployed API URL and builds an APK', () => {
    expect(easJson.build.preview.env).toEqual(
      expect.objectContaining({ EXPO_PUBLIC_API_URL: 'https://api.stopwatchscheduler.app/api' })
    );
    expect(easJson.build.preview.android).toEqual(
      expect.objectContaining({ buildType: 'apk' })
    );
  });
});

describe('over-the-air updates', () => {
  const updatesUrl = 'https://u.expo.dev/d31ca765-c177-496f-a42e-a0578d2fc5d4';

  it.each([undefined, 'development'])(
    'config has the fingerprint policy and the updates URL (APP_VARIANT=%s)',
    (variant) => {
      const config = loadConfig(variant) as Record<string, unknown>;
      expect(config.runtimeVersion).toEqual({ policy: 'fingerprint' });
      expect(config.updates).toEqual(expect.objectContaining({ url: updatesUrl }));
    }
  );

  it('eas.json gives preview and development their channels', () => {
    const build = easJson.build as Record<string, Record<string, unknown>>;
    expect(build.preview.channel).toBe('preview');
    expect(build.development.channel).toBe('development');
    expect(build.preview.env).toEqual({
      EXPO_PUBLIC_API_URL: 'https://api.stopwatchscheduler.app/api',
    });
    expect(build.preview.android).toEqual({ buildType: 'apk' });
    expect(build.preview.distribution).toBe('internal');
  });

  it('deploy.sh ships the phone update after the backend update', () => {
    const script = readFileSync(join(__dirname, '../../../deploy.sh'), 'utf8');
    expect(script).toMatch(/^set -euo pipefail$/m);
    const backendAt = script.indexOf('az containerapp update');
    const updateAt = script.indexOf('eas update --channel preview');
    expect(backendAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(backendAt);
    const updateLine = script.slice(updateAt).split('\n')[0];
    expect(updateLine).toContain('--message');
    expect(updateLine).toContain('--non-interactive');
    const block = script.slice(backendAt, updateAt + updateLine.length);
    expect(block).toContain('EXPO_PUBLIC_API_URL=https://api.stopwatchscheduler.app/api');
    expect(block).toContain('mobile');
  });
});
