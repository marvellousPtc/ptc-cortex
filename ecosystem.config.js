module.exports = {
  apps: [
    {
      name: 'ptc-cortex',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3001',
      cwd: '/ptc/ptc-cortex',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_BASE_PATH: '/chat',
      },
      // better-sqlite3 + HuggingFace 模型加载需要更长启动时间
      wait_ready: true,
      listen_timeout: 30000,
      // 优雅关闭
      kill_timeout: 5000,
    },
  ],
};
