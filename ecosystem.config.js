module.exports = {
  apps: [
    {
      name: "placement-bot",
      script: "./dist/app.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
