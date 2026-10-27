const nodeInterpreter = '/opt/30nice-mail-cloud-runtime/node-v22.23.4-linux-x64/bin/node';

module.exports = {
  apps: [
    {
      name: 'mailcloud-api',
      cwd: '/opt/30nice-mail-cloud',
      script: 'apps/api/dist/main.js',
      interpreter: nodeInterpreter,
      env: { API_PORT: '3013', NODE_ENV: 'production' },
    },
    {
      name: 'mailcloud-portal',
      cwd: '/opt/30nice-mail-cloud/apps/portal',
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3012',
      interpreter: nodeInterpreter,
      env: { NODE_ENV: 'production' },
    },
  ],
};

