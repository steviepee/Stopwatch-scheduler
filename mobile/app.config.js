module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') {
    return config;
  }
  return {
    ...config,
    name: 'Stopwatch Scheduler (Dev)',
    android: { ...config.android, package: 'app.workflow.stopwatch.dev' },
  };
};
