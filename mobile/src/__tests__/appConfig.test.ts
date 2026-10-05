// C8 contract (D64): mobile/app.config.js takes app.json's config and, only when
// APP_VARIANT=development, renames the app and moves it to the .dev package so a standalone
// build installs beside the dev client. eas.json wires the variant into the development
// profile and bakes the deployed API URL into a preview APK.

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
