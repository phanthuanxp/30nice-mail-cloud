const nodeInterpreter = '/opt/30nice-mail-cloud-runtime/node-v22.23.4-linux-x64/bin/node';

module.exports = {
  apps: [
    {
      name: 'mailcloud-worker', cwd: '/opt/30nice-mail-cloud',
      script: 'apps/api/dist/provisioning-worker.js', interpreter: nodeInterpreter,
      env: { NODE_ENV: 'production', RELEASE_SHA: process.env.DEPLOY_COMMIT_SHA || process.env.RELEASE_SHA || '' }, kill_timeout: 60000,
    },
    {
      name: 'mailcloud-api',
      cwd: '/opt/30nice-mail-cloud',
      script: 'apps/api/dist/main.js',
      interpreter: nodeInterpreter,
      env: { API_PORT: '3013', NODE_ENV: 'production', RELEASE_SHA: process.env.DEPLOY_COMMIT_SHA || process.env.RELEASE_SHA || '' },
    },
    {
      name: 'mailcloud-portal',
      cwd: '/opt/30nice-mail-cloud/apps/portal',
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3012',
      interpreter: nodeInterpreter,
      env: { NODE_ENV: 'production', RELEASE_SHA: process.env.DEPLOY_COMMIT_SHA || process.env.RELEASE_SHA || '' },
    },
  ],
};

