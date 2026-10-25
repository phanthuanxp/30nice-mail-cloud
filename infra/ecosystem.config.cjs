module.exports = {
  apps: [
    {
      name: 'mailcloud-api',
      cwd: '/opt/30nice-mail-cloud',
      script: 'apps/api/dist/main.js',
      env: { API_PORT: '3011', NODE_ENV: 'production' },
    },
    {
      name: 'mailcloud-portal',
      cwd: '/opt/30nice-mail-cloud/apps/portal',
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3012',
      env: { NODE_ENV: 'production' },
    },
  ],
};
